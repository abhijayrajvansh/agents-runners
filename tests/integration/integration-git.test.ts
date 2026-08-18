import { writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { IntegrationService } from "../../src/git/integration-service.js";
import { CommandRunner } from "../../src/process/command-runner.js";
import { WorktreeService } from "../../src/runners/worktree-service.js";
import { projectConfig } from "../helpers/project-config.js";
import { createGitProjectWithRemote } from "../helpers/git-project.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()));
});

describe("IntegrationService", () => {
  it("merges a candidate in the isolated integration worktree and pushes dev", async () => {
    const project = await createGitProjectWithRemote();
    cleanups.push(project.cleanup);
    const commands = new CommandRunner();
    const config = projectConfig({
      project: {
        id: "demo",
        name: "Demo",
        repositoryRoot: project.root,
        integrationBranch: "dev",
        remote: "origin"
      }
    });
    const worktrees = new WorktreeService(commands);
    const developer = await worktrees.ensureRunner(config, "developer", 1);
    await writeFile(path.join(developer.worktreePath, "feature.txt"), "delivered\n", "utf8");
    await project.git(["add", "feature.txt"], developer.worktreePath);
    await project.git(["commit", "-m", "feat: deliver feature"], developer.worktreePath);
    const integration = new IntegrationService(commands, worktrees);

    const result = await integration.integrate(config, developer.branch, ["node -e \"process.exit(0)\""]);
    const remoteDev = await project.git(["ls-remote", "origin", "refs/heads/dev"]);

    expect(remoteDev.split(/\s+/)[0]).toBe(result.commit);
    expect(result.integrationWorktree).toContain("integrator");
  });

  it("does not push dev when integration verification fails", async () => {
    const project = await createGitProjectWithRemote();
    cleanups.push(project.cleanup);
    const originalDev = (await project.git(["ls-remote", "origin", "refs/heads/dev"])).split(/\s+/)[0];
    const commands = new CommandRunner();
    const config = projectConfig({
      project: {
        id: "demo",
        name: "Demo",
        repositoryRoot: project.root,
        integrationBranch: "dev",
        remote: "origin"
      }
    });
    const worktrees = new WorktreeService(commands);
    const developer = await worktrees.ensureRunner(config, "developer", 1);
    await writeFile(path.join(developer.worktreePath, "broken.txt"), "broken\n", "utf8");
    await project.git(["add", "broken.txt"], developer.worktreePath);
    await project.git(["commit", "-m", "feat: broken feature"], developer.worktreePath);
    const integration = new IntegrationService(commands, worktrees);

    await expect(integration.integrate(config, developer.branch, ["node -e \"process.exit(2)\""]))
      .rejects.toMatchObject({ code: "VERIFICATION_FAILED" });
    const remoteDev = (await project.git(["ls-remote", "origin", "refs/heads/dev"])).split(/\s+/)[0];

    expect(remoteDev).toBe(originalDev);
  });
});
