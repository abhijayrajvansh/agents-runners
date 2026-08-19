import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import {
  parseJsonLine,
  type AgentCommandCheck,
  type AgentEvent,
  type AgentInvocation,
  type AgentProvider
} from "./agent-provider.js";

export const CODEX_DEFAULT_RUNNER_MODEL = "gpt-5.6-sol";
export const CODEX_DEFAULT_DONNA_MODEL = "gpt-5.6-luna";

export class CodexProvider implements AgentProvider {
  readonly kind = "codex" as const;
  readonly displayName = "Codex";
  readonly command: string;
  readonly configOverrides: string[];
  readonly defaultRunnerModel = CODEX_DEFAULT_RUNNER_MODEL;
  readonly defaultDonnaModel = CODEX_DEFAULT_DONNA_MODEL;

  constructor(command = "codex", configOverrides: string[] = []) {
    this.command = command;
    this.configOverrides = configOverrides;
  }

  buildTurnArgs(invocation: AgentInvocation): string[] {
    return buildCodexArgs({ ...invocation, configOverrides: invocation.configOverrides ?? this.configOverrides });
  }

  buildInteractiveArgs(invocation: AgentInvocation): string[] {
    return [
      ...codexModelOptions(invocation, invocation.configOverrides ?? this.configOverrides),
      ...(invocation.fullAccess ? ["--dangerously-bypass-approvals-and-sandbox"] : []),
      "--no-alt-screen",
      "-C",
      invocation.worktreePath
    ];
  }

  parseEvent(line: string): AgentEvent {
    return parseCodexEvent(line);
  }

  healthChecks(): AgentCommandCheck[] {
    return [
      { id: "codex", label: "Codex CLI", command: this.command, args: ["--version"] },
      { id: "codex-auth", label: "Codex authentication", command: this.command, args: ["login", "status"] }
    ];
  }
}

function codexModelOptions(invocation: AgentInvocation, configOverrides: string[]): string[] {
  return [
    ...(invocation.model ? ["--model", invocation.model] : []),
    ...(invocation.reasoningEffort
      ? ["--config", `model_reasoning_effort=${JSON.stringify(invocation.reasoningEffort)}`]
      : []),
    ...configOverrides.flatMap(value => ["--config", value])
  ];
}

export function buildCodexArgs(input: AgentInvocation): string[] {
  const modelOptions = codexModelOptions(input, input.configOverrides ?? []);
  if (input.threadId) {
    return [
      "exec",
      "resume",
      input.threadId,
      "-",
      "--json",
      ...modelOptions,
      ...(input.fullAccess ? ["--dangerously-bypass-approvals-and-sandbox"] : [])
    ];
  }
  return [
    "exec",
    "-",
    "--json",
    ...modelOptions,
    ...(input.fullAccess ? ["--dangerously-bypass-approvals-and-sandbox"] : []),
    "-C",
    input.worktreePath
  ];
}

export function detectCodexRouterOverrides(configPath = path.join(homedir(), ".codex", "config.toml")): string[] {
  try {
    const source = readFileSync(configPath, "utf8");
    const providers = [...source.matchAll(/^\[model_providers\.(?:"([^"]+)"|([A-Za-z0-9_-]+))\]\s*$/gm)]
      .map(match => match[1] ?? match[2]);
    if (!providers.includes("codex-router")) return [];
    return [
      'model_provider="codex-router"',
      "model_providers.codex-router.supports_websockets=false"
    ];
  } catch {
    return [];
  }
}

export function parseCodexEvent(line: string): AgentEvent {
  const raw = parseJsonLine(line);
  if (!raw) return { type: "process.output", text: line };
  if (raw.type === "thread.started" && typeof raw.thread_id === "string") {
    return { type: "thread.started", threadId: raw.thread_id, raw };
  }
  if (raw.type === "item.completed" && isAgentMessage(raw.item)) {
    return { type: "message.completed", text: raw.item.text, raw };
  }
  return { type: "agent.event", raw };
}

function isAgentMessage(value: unknown): value is { type: "agent_message"; text: string } {
  return Boolean(value && typeof value === "object" &&
    (value as { type?: unknown }).type === "agent_message" &&
    typeof (value as { text?: unknown }).text === "string");
}
