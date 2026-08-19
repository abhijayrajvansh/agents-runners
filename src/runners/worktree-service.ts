import { access, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

import type { ProjectConfig, RoleName } from "../domain/types.js";
import { CommandError, type CommandRunner } from "../process/command-runner.js";

export type RunnerWorktree = {
  id: string;
  role: RoleName;
  slot: number;
  branch: string;
  worktreePath: string;
};

export type IntegrationWorktree = {
  branch: string;
  worktreePath: string;
};

export class WorktreeServiceError extends Error {
  readonly code: "DIRTY_WORKTREE";

  constructor(message: string) {
    super(message);
    this.name = "WorktreeServiceError";
    this.code = "DIRTY_WORKTREE";
  }
}

export class WorktreeService {
  readonly commands: CommandRunner;
  #fetches = new Map<string, Promise<void>>();

  constructor(commands: CommandRunner) {
    this.commands = commands;
  }

  async ensureRunner(config: ProjectConfig, role: RoleName, slot: number): Promise<RunnerWorktree> {
    const suffix = String(slot).padStart(2, "0");
    const id = `${role}-${suffix}`;
    const branch = `${config.worktrees.branchPrefix}/${id}`;
    const worktreePath = path.join(resolveWorktreeRoot(config), id);
    await this.#ensureWorktree(config, branch, worktreePath);
    await this.#copyEnvironment(config, worktreePath);
    return { id, role, slot, branch, worktreePath };
  }

  async ensureIntegration(config: ProjectConfig): Promise<IntegrationWorktree> {
    const branch = `${config.worktrees.branchPrefix}/integrator`;
    const worktreePath = path.join(resolveWorktreeRoot(config), "integrator");
    await this.#ensureWorktree(config, branch, worktreePath);
    return { branch, worktreePath };
  }

  async sealDelivery(config: ProjectConfig, sourceBranch: string, ticketId: string): Promise<string> {
    const safeTicket = ticketId.replace(/[^a-zA-Z0-9_-]/g, "-");
    const branch = `${config.worktrees.branchPrefix}/ticket-${safeTicket}`;
    const commit = (await this.commands.run("git", ["rev-parse", sourceBranch], { cwd: config.project.repositoryRoot })).stdout.trim();
    await this.commands.run("git", ["update-ref", `refs/heads/${branch}`, commit], { cwd: config.project.repositoryRoot });
    if (await this.hasRemote(config) && config.automation.autoPush) {
      await this.commands.run("git", ["push", config.project.remote, `+${branch}:${branch}`], { cwd: config.project.repositoryRoot });
    }
    return branch;
  }

  async removeDeliveryBranch(config: ProjectConfig, branch: string): Promise<void> {
    await this.commands.run("git", ["branch", "-D", branch], { cwd: config.project.repositoryRoot }).catch(error => {
      if (!(error instanceof CommandError)) throw error;
    });
    if (await this.hasRemote(config)) {
      await this.commands.run("git", ["push", config.project.remote, "--delete", branch], { cwd: config.project.repositoryRoot }).catch(error => {
        if (!(error instanceof CommandError)) throw error;
      });
    }
  }

  async synchronize(
    config: ProjectConfig,
    worktreePath: string,
    targetRef: string,
    mode: "fast-forward" | "merge" | "exact" = "fast-forward",
    resumeDirty = false
  ): Promise<void> {
    const status = await this.commands.run("git", ["status", "--porcelain"], { cwd: worktreePath });
    if (status.stdout.trim()) {
      if (resumeDirty) return;
      throw new WorktreeServiceError(`Persistent worktree ${worktreePath} is dirty`);
    }
    if (await this.hasRemote(config)) {
      await this.#fetchRemote(config);
    }
    if (mode === "exact") {
      await this.commands.run("git", ["reset", "--hard", targetRef], { cwd: worktreePath });
    } else if (mode === "merge") {
      try {
        await this.commands.run("git", ["merge", "--no-edit", targetRef], { cwd: worktreePath });
      } catch (error) {
        const conflicts = await this.commands.run("git", ["diff", "--name-only", "--diff-filter=U"], { cwd: worktreePath });
        if (resumeDirty && conflicts.stdout.trim()) return;
        throw error;
      }
    } else {
      await this.commands.run("git", ["merge", "--ff-only", targetRef], { cwd: worktreePath });
    }
  }

  async hasRemote(config: ProjectConfig): Promise<boolean> {
    try {
      await this.commands.run("git", ["remote", "get-url", config.project.remote], { cwd: config.project.repositoryRoot });
      return true;
    } catch (error) {
      if (error instanceof CommandError) return false;
      throw error;
    }
  }

  async integrationRef(config: ProjectConfig, refresh = true): Promise<string> {
    if (!await this.hasRemote(config)) return config.project.integrationBranch;
    if (refresh) await this.#fetchRemote(config);
    return `${config.project.remote}/${config.project.integrationBranch}`;
  }

  async #fetchRemote(config: ProjectConfig): Promise<void> {
    const key = `${config.project.repositoryRoot}\0${config.project.remote}`;
    const active = this.#fetches.get(key);
    if (active) return active;
    const fetch = this.commands.run("git", ["fetch", config.project.remote], { cwd: config.project.repositoryRoot }).then(() => undefined);
    this.#fetches.set(key, fetch);
    try {
      await fetch;
    } finally {
      if (this.#fetches.get(key) === fetch) this.#fetches.delete(key);
    }
  }

  async #ensureWorktree(config: ProjectConfig, branch: string, worktreePath: string): Promise<void> {
    if (await exists(path.join(worktreePath, ".git"))) {
      return;
    }
    await mkdir(path.dirname(worktreePath), { recursive: true });
    const base = await this.integrationRef(config);
    const branchExists = await this.#branchExists(config.project.repositoryRoot, branch);
    const args = branchExists
      ? ["worktree", "add", worktreePath, branch]
      : ["worktree", "add", worktreePath, "-b", branch, base];
    await this.commands.run("git", args, { cwd: config.project.repositoryRoot });
  }

  async #branchExists(repositoryRoot: string, branch: string): Promise<boolean> {
    try {
      await this.commands.run("git", ["show-ref", "--verify", `refs/heads/${branch}`], { cwd: repositoryRoot });
      return true;
    } catch (error) {
      if (error instanceof CommandError) return false;
      throw error;
    }
  }

  async #copyEnvironment(config: ProjectConfig, worktreePath: string): Promise<void> {
    for (const filename of config.environments.files) {
      if (!config.environments.allowProduction && /prod(uction)?/i.test(filename)) continue;
      const source = path.join(config.project.repositoryRoot, filename);
      if (!await exists(source)) continue;
      const destination = path.join(worktreePath, filename);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(source, destination);
    }
  }
}

function resolveWorktreeRoot(config: ProjectConfig): string {
  return path.isAbsolute(config.worktrees.root)
    ? config.worktrees.root
    : path.join(config.project.repositoryRoot, config.worktrees.root);
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
