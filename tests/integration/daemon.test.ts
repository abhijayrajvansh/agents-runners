import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { startDaemon } from "../../src/server/daemon.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()));
});

describe("startDaemon", () => {
  it("binds loopback, writes runtime metadata, and releases its lock", async () => {
    const runtimeRoot = await mkdtemp(path.join(tmpdir(), "codex-runners-daemon-"));
    cleanups.push(() => rm(runtimeRoot, { recursive: true, force: true }));
    const daemon = await startDaemon({ host: "127.0.0.1", port: 0, runtimeRoot, version: "0.1.0" });

    const response = await fetch(`${daemon.url}/health`);
    const metadata = JSON.parse(await readFile(path.join(runtimeRoot, "daemon.json"), "utf8"));

    expect(response.ok).toBe(true);
    expect(metadata).toMatchObject({ pid: process.pid, host: "127.0.0.1", port: daemon.port });
    await expect(startDaemon({ host: "127.0.0.1", port: 0, runtimeRoot, version: "0.1.0" }))
      .rejects.toMatchObject({ code: "DAEMON_ALREADY_RUNNING" });

    await daemon.close();
    const restarted = await startDaemon({ host: "127.0.0.1", port: 0, runtimeRoot, version: "0.1.0" });
    await restarted.close();
  });

  it("rejects non-loopback hosts", async () => {
    const runtimeRoot = await mkdtemp(path.join(tmpdir(), "codex-runners-daemon-"));
    cleanups.push(() => rm(runtimeRoot, { recursive: true, force: true }));

    await expect(startDaemon({ host: "0.0.0.0", port: 4777, runtimeRoot, version: "0.1.0" }))
      .rejects.toThrow("127.0.0.1");
  });
});
