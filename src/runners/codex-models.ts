import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

const CachedModelsSchema = z.object({
  models: z.array(z.object({
    slug: z.string().min(1),
    display_name: z.string().min(1),
    description: z.string().default(""),
    visibility: z.string().optional(),
    supported_in_api: z.boolean().optional()
  }).passthrough())
}).passthrough();

export type CodexModelOption = {
  id: string;
  label: string;
  description: string;
  source: "Codex" | "Codex Router";
};

export async function listAvailableCodexModels(): Promise<CodexModelOption[]> {
  const sources = [
    { path: join(homedir(), ".codex", "models_cache.json"), source: "Codex" as const },
    { path: join(homedir(), ".codex", "codex-router", "merged-models.json"), source: "Codex Router" as const }
  ];
  const models = new Map<string, CodexModelOption>();
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
          source: source.source
        });
      }
    } catch {
      // A missing optional catalog only removes that provider from the selector.
    }
  }
  return [...models.values()];
}
