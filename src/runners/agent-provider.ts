// An agent provider adapts one coding-agent CLI to the runner engine. Every
// provider turns an invocation into argv for a headless, JSONL-streaming turn,
// and normalizes that CLI's stream back into the shared AgentEvent vocabulary.

export type AgentKind = "codex" | "claude";

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max" | "ultra";

export type AgentEvent =
  | { type: "thread.started"; threadId: string; raw: Record<string, unknown> }
  | { type: "message.completed"; text: string; raw: Record<string, unknown> }
  | { type: "agent.event"; raw: Record<string, unknown> }
  | { type: "process.output"; text: string };

// A thread is one resumable agent conversation. Codex calls it a thread and
// Claude Code calls it a session; the engine only needs the resume handle.
export type AgentInvocation = {
  threadId?: string;
  fullAccess: boolean;
  worktreePath: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  configOverrides?: string[];
};

export type AgentCommandCheck = {
  id: string;
  label: string;
  command: string;
  args: string[];
};

export interface AgentProvider {
  readonly kind: AgentKind;
  readonly displayName: string;
  readonly command: string;
  readonly configOverrides: string[];
  readonly defaultRunnerModel: string;
  readonly defaultDonnaModel: string;
  // Headless turn: reads the prompt on stdin, writes JSONL events on stdout.
  buildTurnArgs(invocation: AgentInvocation): string[];
  // Interactive turn: the human-attachable console pane for the same worktree.
  buildInteractiveArgs(invocation: AgentInvocation): string[];
  parseEvent(line: string): AgentEvent;
  healthChecks(): AgentCommandCheck[];
}

export type AgentSelection = {
  kind: AgentKind;
  command?: string;
};

export const AGENT_KINDS: readonly AgentKind[] = ["codex", "claude"];

export function isAgentKind(value: unknown): value is AgentKind {
  return typeof value === "string" && (AGENT_KINDS as readonly string[]).includes(value);
}

// Every provider's stream is line-delimited JSON with occasional plain process
// output mixed in, so the object/non-object split is shared.
export function parseJsonLine(line: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(line) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}
