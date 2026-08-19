import { describe, expect, it } from "vitest";

import { formatProjectSessionSummary, selectProjectRoots } from "../../src/cli/project-session.js";
import { ProjectConfigSchema } from "../../src/domain/schema.js";
import type { RunnerRecord } from "../../src/orchestration/runner-pool.js";

const now = "2026-08-19T00:00:00.000Z";
const config = ProjectConfigSchema.parse({
  version: 1,
  project: {
    id: "com",
    name: "com",
    repositoryRoot: "/projects/com",
    integrationBranch: "dev",
    remote: "origin"
  },
  server: { host: "127.0.0.1", port: 4777, openBrowser: true },
  board: {
    revision: 1,
    columns: ["backlog", "todo", "in_progress", "review", "qa", "blocked", "done"],
    tickets: [{
      id: "schema",
      title: "Define project schema",
      description: "",
      acceptanceCriteria: [],
      status: "review",
      priority: "medium",
      type: "feature",
      tags: [],
      comments: [],
      dependencies: [],
      developmentInstructions: "",
      qaInstructions: "",
      environment: "development",
      createdAt: now,
      updatedAt: now
    }]
  },
  metadata: { createdAt: now, updatedAt: now }
});

describe("project session list", () => {
  it("shows only active agents with their ticket titles", () => {
    const runners: RunnerRecord[] = [
      {
        id: "reviewer-01",
        role: "reviewer",
        slot: 1,
        status: "working",
        worktreePath: "/worktrees/reviewer-01",
        branch: "codex-runners/reviewer-01",
        tmuxTarget: "codex-runners-com:reviewer-01",
        ticketId: "schema"
      },
      {
        id: "developer-01",
        role: "developer",
        slot: 1,
        status: "idle",
        worktreePath: "/worktrees/developer-01",
        branch: "codex-runners/developer-01",
        tmuxTarget: "codex-runners-com:developer-01"
      }
    ];

    expect(formatProjectSessionSummary(config, runners)).toBe([
      "com · dev",
      "Local:  http://127.0.0.1:4777/projects/com",
      "",
      "Active agents · 1",
      "🔍 reviewer-01  Define project schema"
    ].join("\n"));
  });

  it("selects only the registered project containing the current directory", () => {
    expect(selectProjectRoots(
      ["/projects/com", "/projects/snake-game"],
      "/projects/com/src",
      false
    )).toEqual(["/projects/com"]);
    expect(selectProjectRoots(
      ["/projects/com", "/projects/snake-game"],
      "/projects/com/src",
      true
    )).toEqual(["/projects/com", "/projects/snake-game"]);
  });
});
