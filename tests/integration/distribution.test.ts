import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");

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
          "Open this project's Codex Runners board.",
          "Ask Donna to coordinate the next ticket."
        ]
      }
    });
    expect(mcp.mcpServers).toHaveProperty("codex-runners");
    expect(packageJson.bin).toEqual({ "codex-runners": "dist/bin/cli.mjs" });
    expect(skill).toMatch(/^---\nname: codex-runners\ndescription: Use when /);
    expect(agent).toContain('default_prompt: "Use $codex-runners');
    expect(license).toContain("MIT License");
    await expect(access(path.join(root, "dist/bin/cli.mjs"))).resolves.toBeUndefined();
    await expect(access(path.join(root, "dist/bin/mcp.mjs"))).resolves.toBeUndefined();
    await expect(access(path.join(root, "dist/public/index.html"))).resolves.toBeUndefined();
  });
});

function read(file: string): Promise<string> {
  return readFile(path.join(root, file), "utf8");
}
