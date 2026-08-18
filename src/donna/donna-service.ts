import path from "node:path";

import type { ProjectConfig } from "../domain/types.js";
import { projectRuntimePath } from "../platform/paths.js";
import type { CodexEvent, CodexService } from "../runners/codex-service.js";
import type { TmuxService } from "../runners/tmux-service.js";
import type { DonnaConversationMessage, ProjectRuntimeRepository } from "../runtime/project-runtime.js";
import type { EventBus } from "../server/event-bus.js";
import type { ProjectRegistry } from "../server/project-registry.js";

export type DonnaEvent =
  | { type: "started"; projectId: string; source: DonnaMessageSource }
  | { type: "message"; projectId: string; text: string }
  | { type: "completed"; projectId: string; message: string; threadId?: string }
  | { type: "error"; projectId: string; message: string };

export type DonnaMessageSource = "browser" | "terminal" | "mcp";

type DonnaDependencies = {
  registry: ProjectRegistry;
  events: EventBus;
  codex: Pick<CodexService, "runTurn">;
  tmux: Pick<TmuxService, "ensurePane">;
  runtimeFor(project: ProjectConfig): ProjectRuntimeRepository;
};

export class DonnaService {
  readonly dependencies: DonnaDependencies;
  #turns = new Map<string, Promise<void>>();

  constructor(dependencies: DonnaDependencies) {
    this.dependencies = dependencies;
  }

  send(projectId: string, message: string, source: DonnaMessageSource = "mcp"): AsyncIterable<DonnaEvent> {
    return this.#send(projectId, message, source);
  }

  history(projectId: string): DonnaConversationMessage[] {
    const project = this.dependencies.registry.get(projectId);
    return this.dependencies.runtimeFor(project).getDonnaMessages(projectId);
  }

  async *#send(projectId: string, message: string, source: DonnaMessageSource): AsyncGenerator<DonnaEvent> {
    const previous = this.#turns.get(projectId) ?? Promise.resolve();
    await previous.catch(() => undefined);
    const queue = new AsyncEventQueue<DonnaEvent>();
    const turn = this.#runTurn(projectId, message, source, event => queue.push(event))
      .catch(error => {
        queue.push({ type: "error", projectId, message: error instanceof Error ? error.message : String(error) });
      })
      .finally(() => queue.close());
    this.#turns.set(projectId, turn);
    try {
      for await (const event of queue) yield event;
      await turn;
    } finally {
      if (this.#turns.get(projectId) === turn) this.#turns.delete(projectId);
    }
  }

  async #runTurn(
    projectId: string,
    message: string,
    source: DonnaMessageSource,
    emit: (event: DonnaEvent) => void
  ): Promise<void> {
    const project = this.dependencies.registry.get(projectId);
    const runtime = this.dependencies.runtimeFor(project);
    const userMessage = runtime.appendDonnaMessage(projectId, { author: "user", text: message, source });
    this.dependencies.events.publish({
      type: "donna.user",
      projectId,
      revision: project.board.revision,
      payload: { message: userMessage }
    });
    const session = sessionName(projectId);
    const pane = await this.dependencies.tmux.ensurePane({
      session,
      window: "donna",
      cwd: project.project.repositoryRoot
    });
    emit({ type: "started", projectId, source });
    let lastMessage = "";
    const threadId = runtime.getDonnaThread(projectId);
    const turnInput = {
      pane,
      runtimeDirectory: path.join(projectRuntimePath(project.project.repositoryRoot), "donna"),
      worktreePath: project.project.repositoryRoot,
      prompt: buildDonnaPrompt(project, message),
      fullAccess: project.automation.fullAccess,
      model: project.donna?.model ?? "gpt-5.6-luna",
      reasoningEffort: project.donna?.reasoningEffort ?? "low",
      env: { CODEX_RUNNERS_PROJECT_ROOT: project.project.repositoryRoot },
      ...(threadId ? { threadId } : {})
    };
    const result = await this.dependencies.codex.runTurn(turnInput, (event: CodexEvent) => {
      if (event.type !== "message.completed") return;
      lastMessage = event.text;
      const donnaEvent: DonnaEvent = { type: "message", projectId, text: event.text };
      emit(donnaEvent);
      this.#publish(projectId, donnaEvent);
    });
    if (result.exitCode !== 0) throw new Error(`Donna exited with code ${result.exitCode}: ${result.message}`);
    if (result.threadId) runtime.setDonnaThread(projectId, result.threadId);
    if (result.message) runtime.appendDonnaMessage(projectId, { author: "donna", text: result.message, source });
    if (result.message && result.message !== lastMessage) {
      const messageEvent: DonnaEvent = { type: "message", projectId, text: result.message };
      emit(messageEvent);
      this.#publish(projectId, messageEvent);
    }
    const completed: DonnaEvent = {
      type: "completed",
      projectId,
      message: result.message,
      ...(result.threadId ? { threadId: result.threadId } : {})
    };
    emit(completed);
    this.#publish(projectId, completed);
  }

  #publish(projectId: string, event: DonnaEvent): void {
    this.dependencies.events.publish({
      type: `donna.${event.type}`,
      projectId,
      revision: this.dependencies.registry.getBoard(projectId).revision,
      payload: { ...event }
    });
  }
}

function buildDonnaPrompt(project: ProjectConfig, message: string): string {
  const summary = project.board.tickets.map(ticket => `${ticket.id} [${ticket.status}] ${ticket.title}`).join("\n") || "No tickets yet.";
  return [
    `You are Donna, the persistent project manager for ${project.project.name}.`,
    "Coordinate work through Codex Runners MCP tools. Create clear tickets, manage dependencies and assignments, inspect runner progress, and explain blockers.",
    "Write concise GitHub-flavored Markdown. Use short paragraphs, proper newline-separated bullets, descriptive headings only when useful, and readable inline code. Never compress multiple bullets onto one line.",
    "Backlog is planning-only. Moving a ticket to Todo or another actionable column starts autonomous delivery.",
    `Current board:\n${summary}`,
    `User message:\n${message}`
  ].join("\n\n");
}

function sessionName(projectId: string): string {
  return `codex-runners-${projectId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  #items: T[] = [];
  #waiters: Array<() => void> = [];
  #closed = false;

  push(item: T): void {
    if (this.#closed) return;
    this.#items.push(item);
    this.#waiters.shift()?.();
  }

  close(): void {
    this.#closed = true;
    for (const wake of this.#waiters.splice(0)) wake();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    while (!this.#closed || this.#items.length > 0) {
      const item = this.#items.shift();
      if (item !== undefined) {
        yield item;
        continue;
      }
      await new Promise<void>(resolve => this.#waiters.push(resolve));
    }
  }
}
