import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import type { AgentKind } from "./agent-provider.js";

const CachedModelsSchema = z.object({
  models: z.array(z.object({
    slug: z.string().min(1),
    display_name: z.string().min(1),
    description: z.string().default(""),
    visibility: z.string().optional(),
    supported_in_api: z.boolean().optional()
  }).passthrough())
}).passthrough();

export type AgentModelOption = {
  id: string;
  label: string;
  description: string;
  agent: AgentKind;
  source: string;
};

// Claude Code has no machine-readable catalog on disk, so its aliases are
// listed here. Aliases always resolve to the newest model in their family.
const CLAUDE_MODELS: AgentModelOption[] = [
  { id: "opus", label: "Opus", description: "Most capable; the default for runner pools.", agent: "claude", source: "Claude Code" },
  { id: "sonnet", label: "Sonnet", description: "Balanced capability and speed.", agent: "claude", source: "Claude Code" },
  { id: "haiku", label: "Haiku", description: "Fastest and cheapest; good for narrow tasks.", agent: "claude", source: "Claude Code" },
  { id: "fable", label: "Fable", description: "Frontier model for the hardest work.", agent: "claude", source: "Claude Code" },
  { id: "claude-opus-5", label: "Claude Opus 5", description: "Pinned Opus 5.", agent: "claude", source: "Claude Code" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", description: "Pinned Sonnet 5.", agent: "claude", source: "Claude Code" },
  { id: "claude-fable-5", label: "Claude Fable 5", description: "Pinned Fable 5.", agent: "claude", source: "Claude Code" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", description: "Pinned Haiku 4.5.", agent: "claude", source: "Claude Code" }
];

export async function listAvailableModels(agent?: AgentKind): Promise<AgentModelOption[]> {
  if (agent === "claude") return listClaudeModels();
  if (agent === "codex") return listCodexModels();
  return [...await listCodexModels(), ...listClaudeModels()];
}

export function listClaudeModels(): AgentModelOption[] {
  return CLAUDE_MODELS.map(model => ({ ...model }));
}

export async function listCodexModels(): Promise<AgentModelOption[]> {
  const sources = [
    { path: join(homedir(), ".codex", "models_cache.json"), source: "Codex" },
    { path: join(homedir(), ".codex", "codex-router", "merged-models.json"), source: "Codex Router" }
  ];
  const models = new Map<string, AgentModelOption>();
  for (const source of sources) {
    try {
      const raw = await readFile(source.path, "utf8");
      const cache = CachedModelsSchema.parse(JSON.parse(raw));
      for (const model of cache.models) {
        if (model.visibility === "hide" || model.supported_in_api === false || models.has(model.slug)) continue;
        models.set(model.slug, {
          id: model.slug,
          label: model.display_name,
          description: model.description,
          agent: "codex",
          source: source.source
        });
      }
    } catch {
      // A missing optional catalog only removes that provider from the selector.
    }
  }
  return [...models.values()];
}
