import { describe, expect, it, vi } from "vitest";

import { runDoctor } from "../../src/doctor/doctor.js";
import type { CommandRunner } from "../../src/process/command-runner.js";
import { createInitializedProject } from "../helpers/initialized-project.js";

describe("runDoctor", () => {
  it("reports a missing tmux dependency without hiding healthy checks", async () => {
    const initialized = await createInitializedProject();
    const commands = {
      run: vi.fn(async (command: string, args: string[]) => {
        if (command === "tmux") throw new Error("not found");
        if (command === "node") return { stdout: "v24.1.0\n", stderr: "", exitCode: 0 };
        if (command === "codex" && args[0] === "login") return { stdout: "Logged in\n", stderr: "", exitCode: 0 };
        return { stdout: "ok\n", stderr: "", exitCode: 0 };
      })
    } as unknown as CommandRunner;

    const report = await runDoctor({ root: initialized.root, commands, fetchHealth: vi.fn().mockResolvedValue(true) });

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(expect.objectContaining({ id: "node", status: "ok" }));
    expect(report.checks).toContainEqual(expect.objectContaining({ id: "tmux", status: "error" }));
    expect(report.checks).toContainEqual(expect.objectContaining({ id: "integration-branch", status: "ok" }));
    await initialized.cleanup();
  });

  it("passes when all local prerequisites and the daemon are healthy", async () => {
    const initialized = await createInitializedProject();
    const commands = {
      run: vi.fn(async (command: string) => ({
        stdout: command === "node" ? "v24.1.0\n" : command === "codex" ? "Logged in\n" : "ok\n",
        stderr: "",
        exitCode: 0
      }))
    } as unknown as CommandRunner;

    await expect(runDoctor({ root: initialized.root, commands, fetchHealth: vi.fn().mockResolvedValue(true) }))
      .resolves.toMatchObject({ ok: true });
    await initialized.cleanup();
  });
});
