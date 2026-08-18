import { readFile } from "node:fs/promises";

import type { Redactor } from "../security/redactor.js";
import type { TmuxPane, TmuxService } from "./tmux-service.js";

export type CodexEvent =
  | { type: "thread.started"; threadId: string; raw: Record<string, unknown> }
  | { type: "message.completed"; text: string; raw: Record<string, unknown> }
  | { type: "codex.event"; raw: Record<string, unknown> }
  | { type: "process.output"; text: string };

export type CodexTurnInput = {
  pane: TmuxPane;
  runtimeDirectory: string;
  worktreePath: string;
  prompt: string;
  threadId?: string;
  fullAccess: boolean;
  model?: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
  env?: Record<string, string>;
  timeoutMs?: number;
};

export class CodexService {
  readonly tmux: TmuxService;
  readonly redactor: Redactor;
  readonly codexCommand: string;

  constructor(tmux: TmuxService, redactor: Redactor, codexCommand = "codex") {
    this.tmux = tmux;
    this.redactor = redactor;
    this.codexCommand = codexCommand;
  }

  async runTurn(input: CodexTurnInput, onEvent?: (event: CodexEvent) => void): Promise<{
    threadId?: string;
    message: string;
    exitCode: number;
    events: CodexEvent[];
  }> {
    const args = buildCodexArgs(input);
    const job = await this.tmux.runInPane(input.pane, {
      command: this.codexCommand,
      args,
      runtimeDirectory: input.runtimeDirectory,
      stdin: input.prompt,
      ...(input.env ? { env: input.env } : {})
    });
    const events: CodexEvent[] = [];
    let processedLines = 0;
    let completed = false;
    let timedOut = false;
    const completion = job.completion.finally(() => { completed = true; });
    const timeout = input.timeoutMs === undefined ? undefined : setTimeout(() => {
      timedOut = true;
      void this.tmux.interruptPane(input.pane.target).catch(() => undefined);
    }, input.timeoutMs);
    timeout?.unref();
    const emitAvailable = async (includePartial: boolean) => {
      let source: string;
      try {
        source = await readFile(job.eventFile, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
      const lines = source.split(/\r?\n/);
      if (!includePartial && source.length > 0 && !/\r?\n$/.test(source)) lines.pop();
      const available = lines.filter(Boolean);
      for (const line of available.slice(processedLines)) {
        const event = this.redactor.redact(parseCodexEvent(line));
        events.push(event);
        onEvent?.(event);
      }
      processedLines = available.length;
    };
    while (!completed) {
      await emitAvailable(false);
      if (!completed) await new Promise(resolve => setTimeout(resolve, 20));
    }
    const exitCode = await completion.finally(() => {
      if (timeout) clearTimeout(timeout);
    });
    await emitAvailable(true);
    if (timedOut) throw new Error(`Codex turn timed out after ${input.timeoutMs}ms`);
    const started = events.find(event => event.type === "thread.started");
    const messages = events.filter((event): event is Extract<CodexEvent, { type: "message.completed" }> => (
      event.type === "message.completed"
    ));
    const result: {
      threadId?: string;
      message: string;
      exitCode: number;
      events: CodexEvent[];
    } = {
      message: messages.at(-1)?.text ?? "",
      exitCode,
      events
    };
    const threadId = started?.type === "thread.started" ? started.threadId : input.threadId;
    if (threadId) result.threadId = threadId;
    return result;
  }
}

export function buildCodexArgs(input: {
  threadId?: string;
  fullAccess: boolean;
  worktreePath: string;
  model?: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
}): string[] {
  const modelOptions = [
    ...(input.model ? ["--model", input.model] : []),
    ...(input.reasoningEffort ? ["--config", `model_reasoning_effort=${JSON.stringify(input.reasoningEffort)}`] : [])
  ];
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

export function parseCodexEvent(line: string): CodexEvent {
  let raw: Record<string, unknown>;
  try {
    const value = JSON.parse(line) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return { type: "process.output", text: line };
    raw = value as Record<string, unknown>;
  } catch {
    return { type: "process.output", text: line };
  }
  if (raw.type === "thread.started" && typeof raw.thread_id === "string") {
    return { type: "thread.started", threadId: raw.thread_id, raw };
  }
  if (raw.type === "item.completed" && isAgentMessage(raw.item)) {
    return { type: "message.completed", text: raw.item.text, raw };
  }
  return { type: "codex.event", raw };
}

function isAgentMessage(value: unknown): value is { type: "agent_message"; text: string } {
  return Boolean(value && typeof value === "object" &&
    (value as { type?: unknown }).type === "agent_message" &&
    typeof (value as { text?: unknown }).text === "string");
}
