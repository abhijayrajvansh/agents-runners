import type { ProjectConfig } from "../domain/types.js";
import { CommandError, type CommandRunner } from "../process/command-runner.js";
import type { WorktreeService } from "../runners/worktree-service.js";

export class IntegrationError extends Error {
  readonly code: "MERGE_FAILED" | "VERIFICATION_FAILED" | "PUSH_FAILED";
  readonly cause?: unknown;

  constructor(code: IntegrationError["code"], message: string, cause?: unknown) {
    super(message);
    this.name = "IntegrationError";
    this.code = code;
    this.cause = cause;
  }
}

export class IntegrationService {
  readonly commands: CommandRunner;
  readonly worktrees: WorktreeService;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(commands: CommandRunner, worktrees: WorktreeService) {
    this.commands = commands;
    this.worktrees = worktrees;
  }

  integrate(
    config: ProjectConfig,
    candidateBranch: string,
    verificationCommands: string[]
  ): Promise<{ commit: string; integrationWorktree: string }> {
    return this.#enqueue(() => this.#integrate(config, candidateBranch, verificationCommands));
  }

  async #integrate(
    config: ProjectConfig,
    candidateBranch: string,
    verificationCommands: string[]
  ): Promise<{ commit: string; integrationWorktree: string }> {
    const integration = await this.worktrees.ensureIntegration(config);
    const hasRemote = await this.worktrees.hasRemote(config);
    const base = await this.worktrees.integrationRef(config);
    await this.commands.run("git", ["reset", "--hard", base], { cwd: integration.worktreePath });
    try {
      await this.commands.run("git", ["merge", "--no-ff", "--no-edit", candidateBranch], { cwd: integration.worktreePath });
    } catch (error) {
      await this.commands.run("git", ["merge", "--abort"], { cwd: integration.worktreePath }).catch(() => undefined);
      throw new IntegrationError("MERGE_FAILED", `Could not merge ${candidateBranch}`, error);
    }

    for (const command of verificationCommands) {
      try {
        await this.commands.runShell(command, integration.worktreePath);
      } catch (error) {
        await this.commands.run("git", ["reset", "--hard", base], { cwd: integration.worktreePath });
        throw new IntegrationError("VERIFICATION_FAILED", `Integration verification failed: ${command}`, error);
      }
    }

    const commit = (await this.commands.run("git", ["rev-parse", "HEAD"], { cwd: integration.worktreePath })).stdout.trim();
    if (hasRemote && config.automation.autoPush) {
      try {
        await this.commands.run("git", ["push", config.project.remote, `HEAD:${config.project.integrationBranch}`], {
          cwd: integration.worktreePath
        });
      } catch (error) {
        throw new IntegrationError("PUSH_FAILED", `Could not push ${config.project.integrationBranch}`, error);
      }
    } else {
      await this.commands.run("git", ["update-ref", `refs/heads/${config.project.integrationBranch}`, "HEAD"], {
        cwd: integration.worktreePath
      });
    }
    return { commit, integrationWorktree: integration.worktreePath };
  }

  #enqueue<R>(operation: () => Promise<R>): Promise<R> {
    const run = this.#queue.then(operation, operation);
    this.#queue = run.then(() => undefined, () => undefined);
    return run;
  }
}
