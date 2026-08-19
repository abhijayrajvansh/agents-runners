import { ProjectConfigSchema, type ProjectConfig } from "../domain/schema.js";
import type { AgentKind } from "../runners/agent-provider.js";

export type ConfigTemplateInput = {
  name: string;
  repositoryRoot: string;
  integrationBranch: string;
  agent?: AgentKind;
};

export function createProjectConfig(input: ConfigTemplateInput): ProjectConfig {
  const slug = input.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "project";
  const now = new Date().toISOString();

  return ProjectConfigSchema.parse({
    version: 1,
    project: {
      id: slug,
      name: input.name,
      repositoryRoot: input.repositoryRoot,
      integrationBranch: input.integrationBranch,
      remote: "origin"
    },
    agent: { kind: input.agent ?? "codex" },
    // Models are left unset so each agent's own default applies, which keeps a
    // project switchable between Codex and Claude Code without editing models.
    donna: { reasoningEffort: "low" },
    board: { revision: 0, tickets: [] },
    metadata: { createdAt: now, updatedAt: now }
  });
}
