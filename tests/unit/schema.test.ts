import { describe, expect, it } from "vitest";

import { ProjectConfigSchema } from "../../src/domain/schema.js";

describe("ProjectConfigSchema", () => {
  it("adds autonomous role and retry defaults to a minimal project", () => {
    const parsed = ProjectConfigSchema.parse({
      version: 1,
      project: {
        id: "demo",
        name: "Demo",
        repositoryRoot: "/tmp/demo",
        integrationBranch: "dev"
      },
      board: { revision: 0, tickets: [] }
    });

    expect(parsed.pools.developer.max).toBe(5);
    expect(parsed.pools.reviewer.max).toBe(5);
    expect(parsed.pools.qa.max).toBe(5);
    expect(parsed.automation.maxRetries).toBe(3);
    expect(parsed.automation.actionableStatuses).toEqual(["todo", "in_progress", "review", "qa"]);
  });

  it("rejects a ticket status outside the configured workflow", () => {
    expect(() => ProjectConfigSchema.parse({
      version: 1,
      project: {
        id: "demo",
        name: "Demo",
        repositoryRoot: "/tmp/demo",
        integrationBranch: "dev"
      },
      board: {
        revision: 0,
        tickets: [{
          id: "ticket-1",
          title: "Broken status",
          status: "shipping",
          createdAt: "2026-08-18T12:00:00.000Z",
          updatedAt: "2026-08-18T12:00:00.000Z"
        }]
      }
    })).toThrow();
  });

  it("rejects unknown secret-shaped top-level fields", () => {
    expect(() => ProjectConfigSchema.parse({
      version: 1,
      project: {
        id: "demo",
        name: "Demo",
        repositoryRoot: "/tmp/demo",
        integrationBranch: "dev"
      },
      board: { revision: 0, tickets: [] },
      apiKey: "must-not-be-stored"
    })).toThrow();
  });
});
