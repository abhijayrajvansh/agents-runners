import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import { initializeProject } from "../../src/init/initialize-project.js";
import { handleSessionStart } from "../../src/hooks/session-start.js";

const exec = promisify(execFile);
const temporaryDirectories: string[] = [];

async function createRepository(branch = "dev") {
  const root = await mkdtemp(path.join(tmpdir(), "agents-runners-init-"));
  temporaryDirectories.push(root);
  await exec("git", ["init", "-b", branch], { cwd: root });
  await exec("git", ["config", "user.email", "agents-runners@example.test"], { cwd: root });
  await exec("git", ["config", "user.name", "Agents Runners Test"], { cwd: root });
  await writeFile(path.join(root, "README.md"), "# Demo\n", "utf8");
  await exec("git", ["add", "README.md"], { cwd: root });
  await exec("git", ["commit", "-m", "initial"], { cwd: root });
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe("initializeProject", () => {
  it("creates project config while preserving existing rules and hooks", async () => {
    const root = await createRepository();
    const pluginRoot = "/Users/example/plugins/agents-runners";
    await writeFile(path.join(root, "AGENTS.md"), "# Existing rules\n\nKeep this.\n", "utf8");
    await mkdir(path.join(root, ".codex"), { recursive: true });
    await writeFile(path.join(root, ".codex", "hooks.json"), JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: "command", command: "notify-stop" }] }] }
    }, null, 2), "utf8");

    const first = await initializeProject(root, { pluginRoot, nodePath: "/usr/bin/node", hookAgents: ["codex"] });
    const second = await initializeProject(root, { pluginRoot, nodePath: "/usr/bin/node", hookAgents: ["codex"] });
    const config = JSON.parse(await readFile(path.join(root, ".agents-runners", "config.json"), "utf8"));
    const agents = await readFile(path.join(root, "AGENTS.md"), "utf8");
    const hooks = JSON.parse(await readFile(path.join(root, ".codex", "hooks.json"), "utf8"));
    const ignore = await readFile(path.join(root, ".gitignore"), "utf8");

    expect(first.created).toContain(".agents-runners/config.json");
    expect(second.created).toEqual([]);
    expect(config.project.integrationBranch).toBe("dev");
    expect(config.automation.fullAccess).toBe(true);
    expect(config.pools).toMatchObject({ developer: { max: 5 }, reviewer: { max: 5 }, qa: { max: 5 } });
    expect(agents).toContain("# Existing rules");
    expect(agents.match(/agents-runners:start/g)).toHaveLength(1);
    expect(hooks.hooks.Stop[0].hooks[0].command).toBe("notify-stop");
    expect(hooks.hooks.SessionStart).toHaveLength(1);
    expect(ignore.match(/\.agents-runners\/runtime\//g)).toHaveLength(1);
  });

  it("installs the Claude Code hook without disturbing other project settings", async () => {
    const root = await createRepository();
    await mkdir(path.join(root, ".claude"), { recursive: true });
    await writeFile(path.join(root, ".claude", "settings.json"), JSON.stringify({
      permissions: { allow: ["Bash(npm run test)"] },
      hooks: { Stop: [{ hooks: [{ type: "command", command: "notify-stop" }] }] }
    }, null, 2), "utf8");

    const result = await initializeProject(root, {
      pluginRoot: "/Users/example/plugins/agents-runners",
      nodePath: "/usr/bin/node",
      agent: "claude",
      hookAgents: ["claude"]
    });
    const settings = JSON.parse(await readFile(path.join(root, ".claude", "settings.json"), "utf8"));
    const memory = await readFile(path.join(root, "CLAUDE.md"), "utf8");

    expect(result.agent).toBe("claude");
    expect(settings.permissions.allow).toEqual(["Bash(npm run test)"]);
    expect(settings.hooks.Stop[0].hooks[0].command).toBe("notify-stop");
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain("hook session-start --agent claude");
    expect(memory).toContain("agents-runners:start");
  });

  it("refuses the default integration branch when dev does not exist", async () => {
    const root = await createRepository("main");

    await expect(initializeProject(root, {
      pluginRoot: "/Users/example/plugins/agents-runners",
      nodePath: "/usr/bin/node"
    })).rejects.toMatchObject({ code: "INTEGRATION_BRANCH_NOT_FOUND" });
  });
});

describe("handleSessionStart", () => {
  it("starts and opens an initialized project while injecting Donna context", async () => {
    const root = await createRepository();
    await initializeProject(root, {
      pluginRoot: "/Users/example/plugins/agents-runners",
      nodePath: "/usr/bin/node",
      hookAgents: ["codex"]
    });
    const ensureDaemon = vi.fn().mockResolvedValue({ url: "http://127.0.0.1:4777/projects/demo", started: true });
    const openBrowser = vi.fn().mockResolvedValue(undefined);

    const output = await handleSessionStart({ cwd: root, source: "startup", session_id: "session-1" }, {
      ensureDaemon,
      openBrowser
    });

    expect(ensureDaemon).toHaveBeenCalledWith(root);
    expect(openBrowser).toHaveBeenCalledWith("http://127.0.0.1:4777/projects/demo");
    expect(output.additionalContext).toContain("Donna");
    expect(output.additionalContext).toContain("get_board");
  });

  it("reuses the existing daemon without opening a second browser tab", async () => {
    const root = await createRepository();
    await initializeProject(root, {
      pluginRoot: "/Users/example/plugins/agents-runners",
      nodePath: "/usr/bin/node",
      hookAgents: ["codex"]
    });
    const ensureDaemon = vi.fn().mockResolvedValue({ url: "http://127.0.0.1:4777/projects/demo", started: false });
    const openBrowser = vi.fn().mockResolvedValue(undefined);

    await handleSessionStart({ cwd: root, source: "startup", session_id: "session-2" }, {
      ensureDaemon,
      openBrowser
    });

    expect(ensureDaemon).toHaveBeenCalledWith(root);
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it("does nothing outside an initialized project", async () => {
    const root = await createRepository();
    const ensureDaemon = vi.fn();

    const output = await handleSessionStart({ cwd: root, source: "startup" }, {
      ensureDaemon,
      openBrowser: vi.fn()
    });

    expect(output).toEqual({});
    expect(ensureDaemon).not.toHaveBeenCalled();
  });
});
