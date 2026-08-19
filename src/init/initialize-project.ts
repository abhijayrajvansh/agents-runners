import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { ProjectConfigSchema, type ProjectConfig } from "../domain/schema.js";
import { AtomicJsonStore, StoreError } from "../storage/atomic-json-store.js";
import { discoverRepository, ensureRepository } from "../platform/project-discovery.js";
import { projectConfigPath, projectRuntimePath } from "../platform/paths.js";
import { createProjectConfig } from "./config-template.js";
import { appendUniqueLines, mergeSessionStartHook, replaceManagedBlock } from "./managed-files.js";

export type InitializeOptions = {
  pluginRoot: string;
  nodePath?: string;
  integrationBranch?: string;
  bootstrapRepository?: boolean;
};

export type InitResult = {
  root: string;
  config: ProjectConfig;
  created: string[];
  updated: string[];
};

const agentsInstructions = `## Codex Runners

When \`.codex-runners/config.json\` exists, use the Codex Runners MCP tools as the shared task source and the bundled Matt Pocock skills as the workflow. Donna is the persistent project manager. Triage and planning statuses are inactive; issues marked \`ready_for_agent\` are processed autonomously one vertical slice at a time. Prefer /grill-with-docs, /to-spec, /to-tickets, /implement, and /code-review over inventing a new process. Do not create unmanaged worker processes or remove persistent runner worktrees. Never print environment-file values into chat, logs, tickets, or commits.`;

async function readText(file: string, fallback = ""): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeIfChanged(file: string, contents: string): Promise<"created" | "updated" | "unchanged"> {
  const previous = await readText(file, "");
  if (previous === contents) return "unchanged";
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, contents, { encoding: "utf8", mode: 0o600 });
  return previous ? "updated" : "created";
}

export async function initializeProject(inputPath: string, options: InitializeOptions): Promise<InitResult> {
  const repository = options.bootstrapRepository
    ? await ensureRepository(inputPath, options.integrationBranch ?? "dev")
    : await discoverRepository(inputPath, options.integrationBranch ?? "dev");
  const root = repository.repositoryRoot;
  const created: string[] = [];
  const updated: string[] = [];
  const configFile = projectConfigPath(root);
  const store = new AtomicJsonStore(configFile, ProjectConfigSchema);
  let config: ProjectConfig;

  try {
    config = await store.load();
  } catch (error) {
    if (!(error instanceof StoreError) || error.code !== "CONFIG_NOT_FOUND") throw error;
    config = await store.write(createProjectConfig({
      name: repository.name,
      repositoryRoot: root,
      integrationBranch: repository.integrationBranch
    }), 0);
    created.push(path.relative(root, configFile));
  }

  await mkdir(projectRuntimePath(root), { recursive: true, mode: 0o700 });

  const agentsPath = path.join(root, "AGENTS.md");
  const agentsResult = await writeIfChanged(
    agentsPath,
    replaceManagedBlock(await readText(agentsPath), "codex-runners", agentsInstructions)
  );
  recordChange(root, agentsPath, agentsResult, created, updated);

  const hooksPath = path.join(root, ".codex", "hooks.json");
  const existingHooksSource = await readText(hooksPath, "{\n  \"hooks\": {}\n}\n");
  const existingHooks = JSON.parse(existingHooksSource) as unknown;
  const cliPath = path.join(options.pluginRoot, "dist", "bin", "cli.mjs");
  const hooks = `${JSON.stringify(mergeSessionStartHook(existingHooks, cliPath, options.nodePath ?? process.execPath), null, 2)}\n`;
  const hooksResult = await writeIfChanged(hooksPath, hooks);
  recordChange(root, hooksPath, hooksResult, created, updated);

  const gitignorePath = path.join(root, ".gitignore");
  const ignore = appendUniqueLines(await readText(gitignorePath), [
    ".codex-runners/runtime/",
    ".codex-runners/**/*.env",
    ".worktrees/codex-runners/"
  ]);
  const ignoreResult = await writeIfChanged(gitignorePath, ignore);
  recordChange(root, gitignorePath, ignoreResult, created, updated);

  return { root, config, created, updated };
}

function recordChange(
  root: string,
  file: string,
  result: "created" | "updated" | "unchanged",
  created: string[],
  updated: string[]
) {
  if (result === "created") created.push(path.relative(root, file));
  if (result === "updated") updated.push(path.relative(root, file));
}
