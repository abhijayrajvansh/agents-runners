import { readFile } from "node:fs/promises";

import type { Redactor } from "../security/redactor.js";
import {
  type AgentEvent,
  type AgentKind,
  type AgentProvider,
  type AgentSelection,
  type ReasoningEffort
} from "./agent-provider.js";
import { ClaudeProvider } from "./claude-provider.js";
import { CodexProvider } from "./codex-provider.js";
import type { TmuxPane, TmuxService } from "./tmux-service.js";

export type { AgentEvent, AgentKind, AgentProvider, AgentSelection } from "./agent-provider.js";

export type AgentTurnInput = {
  pane: TmuxPane;
  runtimeDirectory: string;
  worktreePath: string;
  prompt: string;
  threadId?: string;
  fullAccess: boolean;
  agent?: AgentSelection;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  env?: Record<string, string>;
  timeoutMs?: number;
};

export type AgentTurnResult = {
  threadId?: string;
  message: string;
  exitCode: number;
  events: AgentEvent[];
};

export type AgentServiceOptions = {
  defaultKind?: AgentKind;
  commands?: Partial<Record<AgentKind, string>>;
  configOverrides?: Partial<Record<AgentKind, string[]>>;
};

// One engine, many CLIs: the tmux/JSONL/timeout machinery is identical for
// every agent, so only argv construction and event parsing vary by provider.
export class AgentService {
  readonly tmux: TmuxService;
  readonly redactor: Redactor;
  readonly defaultKind: AgentKind;
  readonly #commands: Partial<Record<AgentKind, string>>;
  readonly #configOverrides: Partial<Record<AgentKind, string[]>>;

  constructor(tmux: TmuxService, redactor: Redactor, options: AgentServiceOptions = {}) {
    this.tmux = tmux;
    this.redactor = redactor;
    this.defaultKind = options.defaultKind ?? "codex";
    this.#commands = options.commands ?? {};
    this.#configOverrides = options.configOverrides ?? {};
  }

  providerFor(selection?: AgentSelection): AgentProvider {
    const kind = selection?.kind ?? this.defaultKind;
    const command = selection?.command ?? this.#commands[kind];
    const overrides = this.#configOverrides[kind] ?? [];
    return kind === "claude" ? new ClaudeProvider(command ?? "claude", overrides) : new CodexProvider(command ?? "codex", overrides);
  }

  async runTurn(input: AgentTurnInput, onEvent?: (event: AgentEvent) => void): Promise<AgentTurnResult> {
    const provider = this.providerFor(input.agent);
    const args = provider.buildTurnArgs({
      fullAccess: input.fullAccess,
      worktreePath: input.worktreePath,
      ...(input.threadId ? { threadId: input.threadId } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {})
    });
    const job = await this.tmux.runInPane(input.pane, {
      command: provider.command,
      args,
      runtimeDirectory: input.runtimeDirectory,
      cwd: input.worktreePath,
      stdin: input.prompt,
      ...(input.env ? { env: input.env } : {})
    });
    const events: AgentEvent[] = [];
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
        const event = this.redactor.redact(provider.parseEvent(line));
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
    if (timedOut) throw new Error(`${provider.displayName} turn timed out after ${input.timeoutMs}ms`);
    const started = events.find(event => event.type === "thread.started");
    const messages = events.filter((event): event is Extract<AgentEvent, { type: "message.completed" }> => (
      event.type === "message.completed"
    ));
    const result: AgentTurnResult = {
      message: messages.at(-1)?.text ?? "",
      exitCode,
      events
    };
    const threadId = started?.type === "thread.started" ? started.threadId : input.threadId;
    if (threadId) result.threadId = threadId;
    return result;
  }
}
