import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

import { MCP_TOOL_NAMES } from "../../src/mcp/tools.js";
import { createInitializedProject } from "../helpers/initialized-project.js";

const root = path.resolve(import.meta.dirname, "../..");
const execFileAsync = promisify(execFile);

describe("plugin distribution", () => {
  it("contains a complete manifest, skill metadata, MCP config, and bundled entry points", async () => {
    const manifest = JSON.parse(await read(".codex-plugin/plugin.json")) as Record<string, unknown>;
    const mcp = JSON.parse(await read(".mcp.json")) as { mcpServers?: Record<string, unknown> };
    const packageJson = JSON.parse(await read("package.json")) as { bin?: Record<string, string> };
    const skill = await read("skills/codex-runners/SKILL.md");
    const agent = await read("skills/codex-runners/agents/openai.yaml");
    const license = await read("LICENSE");

    expect(manifest).toMatchObject({
      name: "codex-runners",
      skills: "./skills/",
      mcpServers: "./.mcp.json",
      license: "MIT",
      interface: {
        displayName: "Codex Runners",
        category: "Productivity",
        defaultPrompt: [
          "Open this project's Codex Runners skill-flow board.",
          "Ask Donna to route the next issue or cut it into tickets with /to-tickets."
        ]
      }
    });
    expect(mcp.mcpServers).toHaveProperty("codex-runners");
    expect(packageJson.bin).toEqual({
      "codex-runners": "dist/bin/cli.mjs",
      "cr": "dist/bin/cli.mjs"
    });
    expect(skill).toMatch(/^---\nname: codex-runners\ndescription: "?Use when /);
    expect(agent).toContain('default_prompt: "Use $codex-runners');
    expect(license).toContain("MIT License");
    await expect(access(path.join(root, "dist/bin/cli.mjs"))).resolves.toBeUndefined();
    await expect(access(path.join(root, "dist/bin/mcp.mjs"))).resolves.toBeUndefined();
    await expect(access(path.join(root, "dist/public/index.html"))).resolves.toBeUndefined();
  });

  it("executes the bundled CLI under Node", async () => {
    const result = await execFileAsync(process.execPath, [path.join(root, "dist/bin/cli.mjs"), "--help"]);

    expect(result.stdout).toContain("Local skill-driven orchestration for Codex");
  });

  it("advertises every tool from the bundled MCP server", async () => {
    const initialized = await createInitializedProject();
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(root, "dist/bin/mcp.mjs")],
      cwd: initialized.root,
      env: {
        ...getDefaultEnvironment(),
        CODEX_RUNNERS_PROJECT_ROOT: initialized.root
      },
      stderr: "pipe"
    });
    const client = new Client({ name: "distribution-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map(tool => tool.name)).toEqual([...MCP_TOOL_NAMES]);
    } finally {
      await client.close();
      await initialized.cleanup();
    }
  });

  it("handshakes when Codex launches it from the plugin directory", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(root, "dist/bin/mcp.mjs")],
      cwd: root,
      env: getDefaultEnvironment(),
      stderr: "pipe"
    });
    const client = new Client({ name: "codex-session-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map(tool => tool.name)).toEqual([...MCP_TOOL_NAMES]);
    } finally {
      await client.close();
    }
  });
});

function read(file: string): Promise<string> {
  return readFile(path.join(root, file), "utf8");
}
