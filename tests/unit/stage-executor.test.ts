import { describe, expect, it, vi } from "vitest";

import { ProjectConfigSchema, type Ticket } from "../../src/domain/schema.js";
import { CodexStageExecutor, parseStageResult } from "../../src/orchestration/codex-stage-executor.js";
import type { StageExecution } from "../../src/orchestration/scheduler.js";

describe("parseStageResult", () => {
  it("accepts a fenced final JSON result", () => {
    expect(parseStageResult("Done.\n```json\n{\"outcome\":\"passed\",\"summary\":\"Ready\",\"findings\":[]}\n```"))
      .toEqual({ kind: "passed", summary: "Ready", findings: [] });
  });

  it("turns malformed output into a blocked result", () => {
    expect(parseStageResult("I could not finish")).toMatchObject({ kind: "blocked" });
  });
});

describe("CodexStageExecutor", () => {
  it("resumes the runner thread and integrates its persistent branch", async () => {
    const codex = {
      runTurn: vi.fn().mockResolvedValue({
        threadId: "thread-2",
        message: '{"outcome":"passed","summary":"Implemented","findings":[]}',
        exitCode: 0,
        events: []
      })
    };
    const integration = {
      integrate: vi.fn().mockResolvedValue({ commit: "abc123", integrationWorktree: "/tmp/integrator" })
    };
    const executor = new CodexStageExecutor(codex, integration);
    const input = execution();

    await expect(executor.execute(input)).resolves.toMatchObject({ kind: "passed" });
    expect(input.runner.threadId).toBe("thread-2");
    expect(codex.runTurn).toHaveBeenCalledWith(expect.objectContaining({
      threadId: "thread-1",
      fullAccess: true,
      worktreePath: "/tmp/developer-1"
    }), expect.any(Function));
    await expect(executor.integrate(input)).resolves.toEqual({ commit: "abc123" });
    expect(integration.integrate).toHaveBeenCalledWith(input.project, input.runner.branch, ["npm run typecheck", "npm test"]);
  });

  it("fails safely when Codex exits unsuccessfully", async () => {
    const codex = {
      runTurn: vi.fn().mockResolvedValue({ message: "command failed", exitCode: 2, events: [] })
    };
    const executor = new CodexStageExecutor(codex, { integrate: vi.fn() });

    await expect(executor.execute(execution())).resolves.toEqual({
      kind: "failed",
      summary: "Codex runner exited with code 2",
      findings: ["command failed"]
    });
  });
});

function execution(): StageExecution {
  const ticket: Ticket = {
    id: "auth",
    title: "Build authentication",
    kind: "ticket",
    source: "to_tickets",
    description: "Add login",
    acceptanceCriteria: ["Users can log in"],
    status: "in_progress",
    priority: "high",
    type: "feature",
    tags: [],
    comments: [],
    dependencies: [],
    assignedRunnerId: "developer-01",
    developmentInstructions: "Use the existing auth layer.",
    qaInstructions: "Test invalid credentials.",
    environment: "development",
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z"
  };
  const project = ProjectConfigSchema.parse({
    version: 1,
    project: { id: "demo", name: "Demo", repositoryRoot: "/tmp/demo", integrationBranch: "dev", remote: "origin" },
    board: { revision: 0, tickets: [] },
    automation: { enabled: true, fullAccess: true, maxRetries: 3, humanInputTimeoutMinutes: 10, autoMerge: true, autoPush: true, actionableStatuses: ["todo", "in_progress", "review", "qa"] },
    pools: {
      developer: { max: 5, instructions: "" },
      reviewer: { max: 5, instructions: "" },
      qa: { max: 5, instructions: "" }
    },
    computerUse: { enabled: true, instructions: "Use Computer Use for human-style QA when requested." },
    verification: { typecheck: ["npm run typecheck"], test: ["npm test"], lint: [], build: [], ui: [] }
  });
  return {
    project,
    ticket,
    runner: {
      id: "developer-01",
      role: "developer",
      slot: 1,
      status: "working",
      worktreePath: "/tmp/developer-1",
      branch: "codex-runners/developer-01",
      tmuxTarget: "codex-runners-demo:developer-01",
      threadId: "thread-1"
    },
    runtime: { attempts: 0, findings: [] }
  };
}
