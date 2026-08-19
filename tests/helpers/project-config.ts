import type { ProjectConfig } from "../../src/domain/types.js";

export function projectConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  const now = "2026-08-18T12:00:00.000Z";
  const base: ProjectConfig = {
    version: 1,
    project: {
      id: "demo-project",
      name: "Demo Project",
      repositoryRoot: "/tmp/demo-project",
      integrationBranch: "dev",
      remote: "origin"
    },
    agent: { kind: "codex" },
    server: {
      host: "127.0.0.1",
      port: 4777,
      openBrowser: true
    },
    board: {
      revision: 0,
      columns: ["backlog", "todo", "in_progress", "review", "qa", "blocked", "done"],
      tickets: []
    },
    automation: {
      enabled: true,
      fullAccess: true,
      maxRetries: 3,
      humanInputTimeoutMinutes: 10,
      autoMerge: false,
      autoPush: true,
      actionableStatuses: ["todo", "in_progress", "review", "qa"]
    },
    pools: {
      developer: { max: 5, instructions: "" },
      reviewer: { max: 5, instructions: "" },
      qa: { max: 5, instructions: "" }
    },
    worktrees: {
      root: ".worktrees/agents-runners",
      persistent: true,
      branchPrefix: "agents-runners"
    },
    environments: {
      files: [".env", ".env.local", ".env.development"],
      allowProduction: false,
      profiles: { development: [".env", ".env.local", ".env.development"] }
    },
    verification: {
      typecheck: [],
      test: [],
      lint: [],
      build: [],
      ui: []
    },
    computerUse: {
      enabled: true,
      instructions: "Use Computer Use for human-style QA when requested."
    },
    metadata: {
      createdAt: now,
      updatedAt: now
    }
  };

  return { ...base, ...overrides };
}
