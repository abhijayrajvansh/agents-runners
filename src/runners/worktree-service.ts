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

  async synchronize(
    config: ProjectConfig,
    worktreePath: string,
    targetRef: string,
    mode: "fast-forward" | "exact" = "fast-forward",
    resumeDirty = false
  ): Promise<void> {
    const status = await this.commands.run("git", ["status", "--porcelain"], { cwd: worktreePath });
    if (status.stdout.trim()) {
      if (resumeDirty) return;
      throw new WorktreeServiceError(`Persistent worktree ${worktreePath} is dirty`);
    }
    await this.commands.run("git", ["fetch", config.project.remote], { cwd: worktreePath });
    if (mode === "exact") {
      await this.commands.run("git", ["reset", "--hard", targetRef], { cwd: worktreePath });
    } else {
      await this.commands.run("git", ["merge", "--ff-only", targetRef], { cwd: worktreePath });
    }
  }

  async #ensureWorktree(config: ProjectConfig, branch: string, worktreePath: string): Promise<void> {
    if (await exists(path.join(worktreePath, ".git"))) {
      return;
    }
    await mkdir(path.dirname(worktreePath), { recursive: true });
    await this.commands.run("git", ["fetch", config.project.remote], { cwd: config.project.repositoryRoot });
    const base = `${config.project.remote}/${config.project.integrationBranch}`;
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
