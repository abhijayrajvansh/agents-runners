import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { launchInteractiveCodex } from "../../src/cli/interactive-codex.js";

describe("launchInteractiveCodex", () => {
  it("launches Codex in the project terminal and waits for the session to exit", async () => {
    const child = new EventEmitter();
    const signals = new EventEmitter();
    const spawnProcess = vi.fn(() => child);
    let completed = false;

    const session = launchInteractiveCodex("/tmp/demo-project", spawnProcess, signals)
      .then(() => { completed = true; });

    expect(spawnProcess).toHaveBeenCalledWith("codex", [], {
      cwd: "/tmp/demo-project",
      env: expect.objectContaining({ CODEX_RUNNERS_BOARD_OPENED: "1" }),
      stdio: "inherit"
    });
    expect(signals.listenerCount("SIGINT")).toBe(1);
    signals.emit("SIGINT");
    await Promise.resolve();
    expect(completed).toBe(false);

    child.emit("exit", 0, null);
    await session;
    expect(completed).toBe(true);
    expect(signals.listenerCount("SIGINT")).toBe(0);
  });

  it("rejects when the interactive Codex session exits unsuccessfully", async () => {
    const child = new EventEmitter();
    const session = launchInteractiveCodex("/tmp/demo-project", () => child);

    child.emit("exit", 17, null);

    await expect(session).rejects.toThrow("Codex exited with status 17");
  });

  it("reports when the Codex executable cannot be launched", async () => {
    const child = new EventEmitter();
    const session = launchInteractiveCodex("/tmp/demo-project", () => child);

    child.emit("error", new Error("spawn codex ENOENT"));

    await expect(session).rejects.toThrow("Could not launch Codex: spawn codex ENOENT");
  });
});
