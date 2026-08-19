import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CommandRunner } from "../../src/process/command-runner.js";
import { WorktreeService } from "../../src/runners/worktree-service.js";
import { projectConfig } from "../helpers/project-config.js";
import { createGitProjectWithRemote } from "../helpers/git-project.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()));
});

describe("WorktreeService", () => {
  it("creates and reuses a persistent role worktree with development environment files", async () => {
    const project = await createGitProjectWithRemote();
    cleanups.push(project.cleanup);
    await writeFile(path.join(project.root, ".env.development"), "FAKE_KEY=development-only\n", "utf8");
    const config = projectConfig({
      project: {
        id: "demo",
        name: "Demo",
        repositoryRoot: project.root,
        integrationBranch: "dev",
        remote: "origin"
      }
    });
    const service = new WorktreeService(new CommandRunner());

    const first = await service.ensureRunner(config, "developer", 1);
    const second = await service.ensureRunner(config, "developer", 1);

    expect(first).toEqual(second);
    expect(first.branch).toBe("agents-runners/developer-01");
    expect(first.worktreePath).toBe(path.join(project.root, ".worktrees", "agents-runners", "developer-01"));
    await expect(access(path.join(first.worktreePath, ".git"))).resolves.toBeUndefined();
    expect(await readFile(path.join(first.worktreePath, ".env.development"), "utf8"))
      .toBe("FAKE_KEY=development-only\n");
  });

  it("fast-forwards a clean persistent runner to a requested candidate branch", async () => {
    const project = await createGitProjectWithRemote();
    cleanups.push(project.cleanup);
    const config = projectConfig({
      project: {
        id: "demo",
        name: "Demo",
        repositoryRoot: project.root,
        integrationBranch: "dev",
        remote: "origin"
      }
    });
    const service = new WorktreeService(new CommandRunner());
    const runner = await service.ensureRunner(config, "reviewer", 1);
    await writeFile(path.join(project.root, "feature.txt"), "ready\n", "utf8");
    await project.git(["add", "feature.txt"]);
    await project.git(["commit", "-m", "feat: add candidate"]);
    const candidate = await project.git(["rev-parse", "HEAD"]);

    await service.synchronize(config, runner.worktreePath, "dev");

    expect(await project.git(["rev-parse", "HEAD"], runner.worktreePath)).toBe(candidate);
  });

  it("points clean reviewer worktrees at the exact candidate when branches diverge", async () => {
    const project = await createGitProjectWithRemote();
    cleanups.push(project.cleanup);
    const config = projectConfig({ project: {
      id: "demo", name: "Demo", repositoryRoot: project.root, integrationBranch: "dev", remote: "origin"
    } });
    const service = new WorktreeService(new CommandRunner());
    const runner = await service.ensureRunner(config, "reviewer", 1);
    await project.git(["checkout", "-b", "candidate-a"]);
    await writeFile(path.join(project.root, "a.txt"), "a\n", "utf8");
    await project.git(["add", "a.txt"]);
    await project.git(["commit", "-m", "feat: add candidate a"]);
    await service.synchronize(config, runner.worktreePath, "candidate-a", "exact");
    await project.git(["checkout", "dev"]);
    await project.git(["checkout", "-b", "candidate-b"]);
    await writeFile(path.join(project.root, "b.txt"), "b\n", "utf8");
    await project.git(["add", "b.txt"]);
    await project.git(["commit", "-m", "feat: add candidate b"]);
    const candidate = await project.git(["rev-parse", "HEAD"]);

    await service.synchronize(config, runner.worktreePath, "candidate-b", "exact");

    expect(await project.git(["rev-parse", "HEAD"], runner.worktreePath)).toBe(candidate);
  });
});
