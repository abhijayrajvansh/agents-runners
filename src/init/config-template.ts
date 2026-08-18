import { ProjectConfigSchema, type ProjectConfig } from "../domain/schema.js";

export type ConfigTemplateInput = {
  name: string;
  repositoryRoot: string;
  integrationBranch: string;
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
    donna: { model: "gpt-5.6-luna", reasoningEffort: "low" },
    board: { revision: 0, tickets: [] },
    metadata: { createdAt: now, updatedAt: now }
  });
}
