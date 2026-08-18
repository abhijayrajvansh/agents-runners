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
};

const fallbackModels: CodexModelOption[] = [
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", description: "Fast and efficient for everyday coordination." },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", description: "Balanced reasoning for complex project work." },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", description: "Frontier reasoning for the hardest tasks." },
  { id: "gpt-5.5", label: "GPT-5.5", description: "General-purpose Codex model." }
];

export async function listAvailableCodexModels(): Promise<CodexModelOption[]> {
  try {
    const raw = await readFile(join(homedir(), ".codex", "models_cache.json"), "utf8");
    const cache = CachedModelsSchema.parse(JSON.parse(raw));
    const models = cache.models
      .filter(model => model.visibility !== "hide" && model.supported_in_api !== false)
      .map(model => ({ id: model.slug, label: model.display_name, description: model.description }));
    return models.length > 0 ? models : fallbackModels;
  } catch {
    return fallbackModels;
  }
}
