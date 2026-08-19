import { describe, expect, it } from "vitest";

import {
  appendUniqueLines,
  mergeSessionStartHook,
  replaceManagedBlock
} from "../../src/init/managed-files.js";

describe("managed project files", () => {
  it("replaces only the Agents Runners block and remains idempotent", () => {
    const existing = "# Team rules\n\nKeep this line.\n";
    const once = replaceManagedBlock(existing, "agents-runners", "Use Donna.\nUse the board.");
    const twice = replaceManagedBlock(once, "agents-runners", "Use Donna.\nUse the board.");

    expect(once).toContain("# Team rules");
    expect(once).toContain("<!-- agents-runners:start -->");
    expect(once.match(/agents-runners:start/g)).toHaveLength(1);
    expect(twice).toBe(once);
  });

  it("preserves unrelated hooks and replaces only its own SessionStart command", () => {
    const existing = {
      description: "Existing notifications",
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "notify-stop" }] }],
        SessionStart: [{
          matcher: "startup|resume",
          hooks: [{ type: "command", command: "/old/plugin/dist/bin/cli.mjs hook session-start" }]
        }]
      }
    };

    const merged = mergeSessionStartHook(existing, "/new/plugin/dist/bin/cli.mjs", "/usr/bin/node");
    const mergedTwice = mergeSessionStartHook(merged, "/new/plugin/dist/bin/cli.mjs", "/usr/bin/node");
    const sessionStart = merged.hooks.SessionStart ?? [];

    expect(merged.hooks.Stop).toEqual(existing.hooks.Stop);
    expect(sessionStart).toHaveLength(1);
    expect(sessionStart[0]?.hooks[0]?.command).toContain("/new/plugin/dist/bin/cli.mjs");
    expect(mergedTwice).toEqual(merged);
  });

  it("appends missing ignore rules once while preserving comments", () => {
    const existing = "# Local files\nnode_modules/\n";
    const once = appendUniqueLines(existing, [".agents-runners/runtime/", ".agents-runners/**/*.env"]);
    const twice = appendUniqueLines(once, [".agents-runners/runtime/", ".agents-runners/**/*.env"]);

    expect(once).toContain("# Local files");
    expect(once.match(/\.agents-runners\/runtime\//g)).toHaveLength(1);
    expect(twice).toBe(once);
  });
});
