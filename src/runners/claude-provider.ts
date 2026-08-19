import {
  parseJsonLine,
  type AgentCommandCheck,
  type AgentEvent,
  type AgentInvocation,
  type AgentProvider,
  type ReasoningEffort
} from "./agent-provider.js";

export const CLAUDE_DEFAULT_RUNNER_MODEL = "opus";
export const CLAUDE_DEFAULT_DONNA_MODEL = "sonnet";

// Claude Code exposes five effort levels; Codex's extra "ultra" tier collapses
// onto the highest one it understands.
const EFFORT_LEVELS: Record<ReasoningEffort, string> = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
  ultra: "max"
};

export class ClaudeProvider implements AgentProvider {
  readonly kind = "claude" as const;
  readonly displayName = "Claude Code";
  readonly command: string;
  readonly configOverrides: string[];
  readonly defaultRunnerModel = CLAUDE_DEFAULT_RUNNER_MODEL;
  readonly defaultDonnaModel = CLAUDE_DEFAULT_DONNA_MODEL;

  constructor(command = "claude", configOverrides: string[] = []) {
    this.command = command;
    this.configOverrides = configOverrides;
  }

  buildTurnArgs(invocation: AgentInvocation): string[] {
    return buildClaudeArgs({ ...invocation, configOverrides: invocation.configOverrides ?? this.configOverrides });
  }

  buildInteractiveArgs(invocation: AgentInvocation): string[] {
    return [
      ...claudeModelOptions(invocation, invocation.configOverrides ?? this.configOverrides),
      ...(invocation.fullAccess ? ["--dangerously-skip-permissions"] : []),
      "--add-dir",
      invocation.worktreePath
    ];
  }

  parseEvent(line: string): AgentEvent {
    return parseClaudeEvent(line);
  }

  healthChecks(): AgentCommandCheck[] {
    return [
      { id: "claude", label: "Claude Code CLI", command: this.command, args: ["--version"] },
      { id: "claude-auth", label: "Claude Code authentication", command: this.command, args: ["auth", "status"] }
    ];
  }
}

function claudeModelOptions(invocation: AgentInvocation, configOverrides: string[]): string[] {
  return [
    ...(invocation.model ? ["--model", invocation.model] : []),
    ...(invocation.reasoningEffort ? ["--effort", EFFORT_LEVELS[invocation.reasoningEffort]] : []),
    // Each override is a settings JSON string or path; Claude Code merges them
    // in order, so the last one wins on conflicting keys.
    ...configOverrides.flatMap(value => ["--settings", value])
  ];
}

export function buildClaudeArgs(input: AgentInvocation): string[] {
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    ...(input.threadId ? ["--resume", input.threadId] : []),
    ...claudeModelOptions(input, input.configOverrides ?? []),
    ...(input.fullAccess ? ["--dangerously-skip-permissions"] : []),
    "--add-dir",
    input.worktreePath
  ];
}

export function parseClaudeEvent(line: string): AgentEvent {
  const raw = parseJsonLine(line);
  if (!raw) return { type: "process.output", text: line };
  // The init frame is the first line of every stream and carries the session id
  // that resumes this thread on the next turn.
  if (raw.type === "system" && raw.subtype === "init" && typeof raw.session_id === "string") {
    return { type: "thread.started", threadId: raw.session_id, raw };
  }
  // The result frame closes the turn and repeats the agent's final answer.
  if (raw.type === "result" && typeof raw.result === "string" && raw.result.length > 0) {
    return { type: "message.completed", text: raw.result, raw };
  }
  if (raw.type === "assistant") {
    const text = assistantText(raw.message);
    if (text) return { type: "message.completed", text, raw };
  }
  return { type: "agent.event", raw };
}

function assistantText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: "text"; text: string } => Boolean(block &&
      typeof block === "object" &&
      (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"))
    .map(block => block.text)
    .join("")
    .trim();
}
