import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { initializeProject } from "../../src/init/initialize-project.js";

const exec = promisify(execFile);

export async function createInitializedProject() {
  const root = await mkdtemp(path.join(tmpdir(), "agents-runners-project-"));
  await exec("git", ["init", "-b", "dev"], { cwd: root });
  await exec("git", ["config", "user.email", "agents-runners@example.test"], { cwd: root });
  await exec("git", ["config", "user.name", "Agents Runners Test"], { cwd: root });
  await writeFile(path.join(root, "README.md"), "# Demo\n", "utf8");
  await exec("git", ["add", "README.md"], { cwd: root });
  await exec("git", ["commit", "-m", "initial"], { cwd: root });
  const initialized = await initializeProject(root, {
    pluginRoot: "/Users/example/plugins/agents-runners",
    nodePath: "/usr/bin/node",
    hookAgents: ["codex"]
  });
  return {
    root,
    config: initialized.config,
    cleanup: () => rm(root, { recursive: true, force: true })
  };
}
