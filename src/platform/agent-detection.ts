import { access, constants } from "node:fs/promises";
import path from "node:path";

import { AGENT_KINDS, type AgentKind } from "../runners/agent-provider.js";

const COMMANDS: Record<AgentKind, string> = { codex: "codex", claude: "claude" };

// Which agent CLIs this machine can actually run. Init uses it to pick a
// default, and to decide which editors get a SessionStart hook.
export async function detectInstalledAgents(env = process.env): Promise<AgentKind[]> {
  const found: AgentKind[] = [];
  for (const kind of AGENT_KINDS) {
    if (await isExecutableOnPath(COMMANDS[kind], env)) found.push(kind);
  }
  return found;
}

export function defaultAgentKind(installed: AgentKind[]): AgentKind {
  // With both available, Codex stays the default so existing projects keep
  // behaving as they did before Claude Code support landed.
  return installed[0] === "claude" && !installed.includes("codex") ? "claude" : "codex";
}

async function isExecutableOnPath(command: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  for (const directory of (env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    try {
      await access(path.join(directory, command), constants.X_OK);
      return true;
    } catch {
      // Keep scanning the remaining PATH entries.
    }
  }
  return false;
}
