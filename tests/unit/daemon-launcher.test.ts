import { describe, expect, it, vi } from "vitest";

import { ensureDaemonForProject } from "../../src/runtime/daemon-launcher.js";
import { projectConfig } from "../helpers/project-config.js";

describe("ensureDaemonForProject", () => {
  it("starts a missing daemon, waits for health, and registers the project", async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new Error("connection refused"))
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });
    const spawnDaemon = vi.fn().mockResolvedValue(undefined);

    const result = await ensureDaemonForProject(projectConfig(), {
      request,
      spawnDaemon,
      sleep: vi.fn().mockResolvedValue(undefined)
    });

    expect(spawnDaemon).toHaveBeenCalledOnce();
    expect(request).toHaveBeenNthCalledWith(1, "http://127.0.0.1:4777/health", { method: "GET" });
    expect(request).toHaveBeenNthCalledWith(3, "http://127.0.0.1:4777/api/projects/register", {
      method: "POST",
      body: { root: "/tmp/demo-project" }
    });
    expect(result.url).toBe("http://127.0.0.1:4777/projects/demo-project");
  });

  it("reuses a healthy daemon without spawning another process", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });
    const spawnDaemon = vi.fn();

    await ensureDaemonForProject(projectConfig(), {
      request,
      spawnDaemon,
      sleep: vi.fn()
    });

    expect(spawnDaemon).not.toHaveBeenCalled();
  });
});
