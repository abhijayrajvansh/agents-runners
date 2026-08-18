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
    const delegated = await this.#delegateWorkRequest(project, message, source);
    if (delegated) {
      emit({ type: "started", projectId, source });
      const messageEvent: DonnaEvent = { type: "message", projectId, text: delegated };
      emit(messageEvent);
      this.#publish(projectId, messageEvent);
      const completed: DonnaEvent = { type: "completed", projectId, message: delegated };
      emit(completed);
      this.#publish(projectId, completed);
      return;
    }
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

  async #delegateWorkRequest(project: ProjectConfig, message: string, source: DonnaMessageSource): Promise<string | null> {
    const request = parseWorkRequest(message);
    if (!request) return null;
    const result = await this.dependencies.registry.createTicket(project.project.id, {
      title: request.title,
      description: message.trim(),
      acceptanceCriteria: [
        "The requested behavior is implemented and works locally.",
        "The developer records the verification performed before review."
      ],
      status: request.planningOnly ? "backlog" : "todo",
      priority: request.urgent ? "high" : "medium",
      type: request.type,
      tags: ["donna"],
      comments: [],
      dependencies: [],
      developmentInstructions: message.trim(),
      qaInstructions: "Verify the requested behavior locally and report concrete evidence.",
      environment: "development"
    }, project.board.revision);
    const reply = request.planningOnly
      ? `I added \`${result.ticket.title}\` to Backlog as \`${result.ticket.id}\`. It will stay in planning until you move it to Todo.`
      : `I started \`${result.ticket.title}\` as \`${result.ticket.id}\`. A developer can claim it now. I’ll keep the board moving through review and QA.`;
    this.dependencies.runtimeFor(this.dependencies.registry.get(project.project.id)).appendDonnaMessage(project.project.id, {
      author: "donna",
      text: reply,
      source
    });
    return reply;
  }
}

function buildDonnaPrompt(project: ProjectConfig, message: string): string {
  const summary = project.board.tickets.map(ticket => `${ticket.id} [${ticket.status}] ${ticket.title}`).join("\n") || "No tickets yet.";
  return [
    `You are Donna, the persistent project manager for ${project.project.name}.`,
    "Coordinate work through Codex Runners MCP tools. Create clear tickets, manage dependencies and assignments, inspect runner progress, and explain blockers. You are a project manager, not a coding worker. Never edit project files, run implementation commands, commit code, or perform a ticket yourself. Delegate implementation, review, and QA to the runner pools.",
    "Talk like a thoughtful human project manager. Answer the question directly without restating it or announcing what you are about to do. Use plain words and natural contractions. Vary sentence and paragraph length. You can have a point of view, admit uncertainty, and use a brief aside when it helps.",
    "Avoid corporate AI prose, forced enthusiasm, canned acknowledgments, rhetorical reversals, fake punchlines, and inflated claims. Do not say 'Great question', 'I hope this helps', 'let us dive in', or 'Would you like me to'. Prefer 'is' and 'has' over phrases like 'serves as' or 'boasts'. Do not use em dashes. Never invent facts, progress, blockers, commits, or citations.",
    "Use GitHub-flavored Markdown only when it makes the answer easier to scan. Keep headings rare, avoid bolding every label, put each list item on its own line, and use readable inline code for ticket IDs and commands.",
    "Keep replies short by default: no more than 100 words or five short lines unless the user asks for detail. For status or blocker questions, state only the current state, the cause, and your recommended next action. Do not list commits, branches, checks, or historical evidence unless asked. End with a question only when a real decision is required.",
    "Backlog is planning-only. Moving a ticket to Todo or another actionable column starts autonomous delivery.",
    `Current board:\n${summary}`,
    `User message:\n${message}`
  ].join("\n\n");
}

function parseWorkRequest(message: string): { title: string; planningOnly: boolean; urgent: boolean; type: "feature" | "bug" | "chore" } | null {
  const text = message.trim();
  const lower = text.toLowerCase();
  const imperative = /^(?:please\s+)?(?:can you\s+|could you\s+)?(build|create|implement|add|develop|make|fix|repair|update|refactor)\b/i.exec(text);
  if (!imperative) return null;
  const verb = imperative[1]?.toLowerCase() ?? "build";
  const planningOnly = /\b(backlog|planning only|do not start|don't start)\b/i.test(text);
  const urgent = /\b(as fast as possible|asap|urgent|immediately|right now|quick)\b/i.test(text);
  const type = verb === "fix" || verb === "repair" ? "bug" as const : verb === "refactor" || verb === "update" ? "chore" as const : "feature" as const;
  const subject = text
    .replace(/^(?:please\s+)?(?:can you\s+|could you\s+)?(?:build|create|implement|add|develop|make|fix|repair|update|refactor)(?:\s+me)?\s+/i, "")
    .replace(/\s+(?:as fast as possible|asap|immediately|right now)[.!?]*$/i, "")
    .replace(/[.!?]+$/g, "")
    .trim();
  const concise = subject.length > 0 ? subject : lower;
  const title = `${verb[0]?.toUpperCase() ?? "B"}${verb.slice(1)} ${concise}`.slice(0, 90).trim();
  return { title, planningOnly, urgent, type };
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
