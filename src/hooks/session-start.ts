import { access } from "node:fs/promises";
import path from "node:path";

import { ProjectConfigSchema } from "../domain/schema.js";
import { projectConfigPath } from "../platform/paths.js";
import { AtomicJsonStore } from "../storage/atomic-json-store.js";

export type SessionStartInput = {
  cwd: string;
  source?: string;
  session_id?: string;
};

export type SessionStartDependencies = {
  ensureDaemon(root: string): Promise<{ url: string }>;
  openBrowser(url: string): Promise<void>;
};

export async function handleSessionStart(
  input: SessionStartInput,
  dependencies: SessionStartDependencies,
  options: { skipBrowser?: boolean } = {}
): Promise<{ additionalContext?: string }> {
  const root = await findInitializedProject(input.cwd);
  if (!root) return {};
  const config = await new AtomicJsonStore(projectConfigPath(root), ProjectConfigSchema).load();
  const daemon = await dependencies.ensureDaemon(root);
  if (config.server.openBrowser && !options.skipBrowser) await dependencies.openBrowser(daemon.url);

  return {
    additionalContext: [
      `Codex Runners is active for ${config.project.name}.`,
      "Donna is the persistent project manager for this project.",
      "Call get_project and get_board before changing tickets, and use revision-protected MCP writes.",
      "Backlog is inactive; actionable tickets are handled by persistent runners."
    ].join(" ")
  };
}

async function findInitializedProject(start: string): Promise<string | null> {
  let current = path.resolve(start);
  const filesystemRoot = path.parse(current).root;
  while (true) {
    try {
      await access(projectConfigPath(current));
      return current;
    } catch {
      if (current === filesystemRoot) return null;
      current = path.dirname(current);
    }
  }
}
