import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CommandRunner } from "../../src/process/command-runner.js";
import { TmuxService } from "../../src/runners/tmux-service.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()));
});

describe("TmuxService", () => {
  it("keeps the runner pane alive after a structured command completes", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codex-runners-tmux-"));
    const session = `codex-runners-test-${process.pid}-${Date.now()}`;
    const service = new TmuxService(new CommandRunner());
    cleanups.push(async () => {
      await service.killSession(session).catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    });

    const pane = await service.ensurePane({ session, window: "developer-01", cwd: directory });
    const job = await service.runInPane(pane, {
      command: process.execPath,
      args: ["-e", "console.log(JSON.stringify({type:'thread.started',thread_id:'thread-1'}))"],
      runtimeDirectory: directory
    });
    const exitCode = await job.completion;
    const windows = await service.listWindows(session);

    expect(exitCode).toBe(0);
    expect(await readFile(job.eventFile, "utf8")).toContain("thread.started");
    expect(windows).toContain("developer-01");
  });
});
