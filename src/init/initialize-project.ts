import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { ProjectConfigSchema, type ProjectConfig } from "../domain/schema.js";
import { AtomicJsonStore, StoreError } from "../storage/atomic-json-store.js";
import { defaultAgentKind, detectInstalledAgents } from "../platform/agent-detection.js";
import { discoverRepository, ensureRepository } from "../platform/project-discovery.js";
import { projectConfigPath, projectRuntimePath } from "../platform/paths.js";
import type { AgentKind } from "../runners/agent-provider.js";
import { createProjectConfig } from "./config-template.js";
import { appendUniqueLines, mergeSessionStartHook, replaceManagedBlock } from "./managed-files.js";

export type InitializeOptions = {
  pluginRoot: string;
  nodePath?: string;
  integrationBranch?: string;
  bootstrapRepository?: boolean;
  // Which agent CLI drives this project's runners. Omitted means "detect".
  agent?: AgentKind;
  // Which editors get a SessionStart hook. Omitted means "every one installed".
  hookAgents?: AgentKind[];
};

export type InitResult = {
  root: string;
  config: ProjectConfig;
  agent: AgentKind;
  created: string[];
  updated: string[];
};

// Where each agent CLI reads its per-project instructions and lifecycle hooks.
const AGENT_FILES: Record<AgentKind, { instructions: string; hooks: string[] }> = {
  codex: { instructions: "AGENTS.md", hooks: [".codex", "hooks.json"] },
  claude: { instructions: "CLAUDE.md", hooks: [".claude", "settings.json"] }
};

const agentsInstructions = `## Agents Runners

When \`.agents-runners/config.json\` exists, use the Agents Runners MCP tools as the shared task source and the bundled Matt Pocock skills as the workflow. Donna is the persistent project manager. Triage and planning statuses are inactive; issues marked \`ready_for_agent\` are processed autonomously one vertical slice at a time. Prefer /grill-with-docs, /to-spec, /to-tickets, /implement, and /code-review over inventing a new process. Do not create unmanaged worker processes or remove persistent runner worktrees. Never print environment-file values into chat, logs, tickets, or commits.`;

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
  const installed = await detectInstalledAgents();
  let config: ProjectConfig;

  try {
    config = await store.load();
  } catch (error) {
    if (!(error instanceof StoreError) || error.code !== "CONFIG_NOT_FOUND") throw error;
    config = await store.write(createProjectConfig({
      name: repository.name,
      repositoryRoot: root,
      integrationBranch: repository.integrationBranch,
      agent: options.agent ?? defaultAgentKind(installed)
    }), 0);
    created.push(path.relative(root, configFile));
  }

  // An explicit --agent on a project that already exists switches it over.
  if (options.agent && options.agent !== config.agent.kind) {
    config = await store.write({ ...config, agent: { ...config.agent, kind: options.agent } }, config.board.revision);
    updated.push(path.relative(root, configFile));
  }

  await mkdir(projectRuntimePath(root), { recursive: true, mode: 0o700 });

  // The board should come up in whichever editor the repo is opened with, so
  // every installed agent gets the hook, not just the one driving the runners.
  const hookAgents = options.hookAgents ?? (installed.length > 0 ? installed : [config.agent.kind]);
  const cliPath = path.join(options.pluginRoot, "dist", "bin", "cli.mjs");

  for (const agent of hookAgents) {
    const files = AGENT_FILES[agent];

    const instructionsPath = path.join(root, files.instructions);
    const instructionsResult = await writeIfChanged(
      instructionsPath,
      replaceManagedBlock(await readText(instructionsPath), "agents-runners", agentsInstructions)
    );
    recordChange(root, instructionsPath, instructionsResult, created, updated);

    const hooksPath = path.join(root, ...files.hooks);
    const existingHooks = JSON.parse(await readText(hooksPath, "{}")) as unknown;
    const hooks = `${JSON.stringify(
      mergeSessionStartHook(existingHooks, cliPath, options.nodePath ?? process.execPath, agent),
      null,
      2
    )}\n`;
    const hooksResult = await writeIfChanged(hooksPath, hooks);
    recordChange(root, hooksPath, hooksResult, created, updated);
  }

  const gitignorePath = path.join(root, ".gitignore");
  const ignore = appendUniqueLines(await readText(gitignorePath), [
    ".agents-runners/runtime/",
    ".agents-runners/**/*.env",
    ".worktrees/agents-runners/"
  ]);
  const ignoreResult = await writeIfChanged(gitignorePath, ignore);
  recordChange(root, gitignorePath, ignoreResult, created, updated);

  return { root, config, agent: config.agent.kind, created, updated };
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
