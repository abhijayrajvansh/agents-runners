import { ProjectConfigSchema, type ProjectConfig, type TicketStatus } from "../../../src/domain/schema.js";

export function projectFixture(status: TicketStatus = "backlog"): ProjectConfig {
  return ProjectConfigSchema.parse({
    version: 1,
    project: {
      id: "demo",
      name: "Northstar",
      repositoryRoot: "/tmp/northstar",
      integrationBranch: "dev",
      remote: "origin"
    },
    board: {
      revision: 4,
      tickets: [{
        id: "auth",
        title: "Build authentication",
        description: "Create the complete login flow.",
        acceptanceCriteria: ["A valid user can sign in"],
        status,
        priority: "high",
        type: "feature",
        tags: ["identity"],
        dependencies: [],
        developmentInstructions: "",
        qaInstructions: "Test invalid credentials.",
        environment: "development",
        createdAt: "2026-08-18T00:00:00.000Z",
        updatedAt: "2026-08-18T00:00:00.000Z"
      }]
    }
  });
}
