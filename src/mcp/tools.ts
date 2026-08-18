import { randomUUID } from "node:crypto";

import type { TicketStatus } from "../domain/types.js";
import type { DonnaService } from "../donna/donna-service.js";
import type { RunnerRecord } from "../orchestration/runner-pool.js";
import { StoreError } from "../storage/atomic-json-store.js";
import type { EventBus } from "../server/event-bus.js";
import type { ProjectRegistry } from "../server/project-registry.js";

export const MCP_TOOL_NAMES = [
  "get_project",
  "get_board",
  "get_ticket",
  "create_ticket",
  "update_ticket",
  "move_ticket",
  "assign_ticket",
  "claim_next_ticket",
  "add_ticket_comment",
  "report_progress",
  "complete_stage",
  "list_runners",
  "get_runner",
  "message_donna",
  "get_activity"
] as const;

export type McpToolName = typeof MCP_TOOL_NAMES[number];

type RunnerDirectory = {
  list(projectId: string): RunnerRecord[];
  get(projectId: string, runnerId: string): RunnerRecord | undefined;
};

type DonnaMessenger = Pick<DonnaService, "send">;

export type McpToolsDependencies = {
  registry: ProjectRegistry;
  events: EventBus;
  runners: RunnerDirectory;
  donna: DonnaMessenger;
};

export class McpTools {
  readonly dependencies: McpToolsDependencies;

  constructor(dependencies: McpToolsDependencies) {
    this.dependencies = dependencies;
  }

  async call(name: McpToolName, rawInput: unknown): Promise<unknown> {
    const input = objectInput(rawInput);
    const project = await this.dependencies.registry.register(stringInput(input, "projectRoot"));
    const projectId = project.project.id;

    switch (name) {
      case "get_project":
        return this.dependencies.registry.get(projectId);
      case "get_board":
        return this.dependencies.registry.getBoard(projectId);
      case "get_ticket":
        return requireTicket(this.dependencies.registry, projectId, stringInput(input, "ticketId"));
      case "create_ticket":
        return this.dependencies.registry.createTicket(
          projectId,
          input.ticket,
          revisionInput(input)
        );
      case "update_ticket":
        return this.dependencies.registry.updateTicket(
          projectId,
          stringInput(input, "ticketId"),
          input.patch,
          revisionInput(input)
        );
      case "move_ticket":
        return this.dependencies.registry.updateTicket(
          projectId,
          stringInput(input, "ticketId"),
          { status: statusInput(input) },
          revisionInput(input)
        );
      case "assign_ticket":
        return this.dependencies.registry.updateTicket(
          projectId,
          stringInput(input, "ticketId"),
          { assignedRunnerId: stringInput(input, "runnerId") },
          revisionInput(input)
        );
      case "claim_next_ticket":
        return this.#claimNext(projectId, input);
      case "add_ticket_comment":
        return this.#addComment(projectId, input);
      case "report_progress":
        return this.#report(projectId, "runner.progress", input);
      case "complete_stage":
        return this.#report(projectId, "runner.stage_completed", input);
      case "list_runners":
        return this.dependencies.runners.list(projectId);
      case "get_runner": {
        const runnerId = stringInput(input, "runnerId");
        const runner = this.dependencies.runners.get(projectId, runnerId);
        if (!runner) throw new Error(`Runner ${runnerId} was not found`);
        return runner;
      }
      case "message_donna": {
        let finalMessage = "";
        for await (const event of this.dependencies.donna.send(projectId, stringInput(input, "message"), "mcp")) {
          if (event.type === "completed") finalMessage = event.message;
          if (event.type === "error") throw new Error(event.message);
        }
        return { message: finalMessage };
      }
      case "get_activity":
        return this.dependencies.events.replay(projectId, nonnegativeInteger(input.since, 0));
    }
  }

  async #claimNext(projectId: string, input: Record<string, unknown>): Promise<unknown> {
    const board = this.dependencies.registry.getBoard(projectId);
    assertRevision(board.revision, revisionInput(input));
    const done = new Set(board.tickets.filter(ticket => ticket.status === "done").map(ticket => ticket.id));
    const ticket = board.tickets.find(candidate => (
      ["todo", "in_progress"].includes(candidate.status) &&
      !candidate.assignedRunnerId &&
      candidate.dependencies.every(dependency => done.has(dependency))
    ));
    if (!ticket) return { revision: board.revision, ticket: null };
    return this.dependencies.registry.updateTicket(
      projectId,
      ticket.id,
      { assignedRunnerId: stringInput(input, "runnerId") },
      board.revision
    );
  }

  async #addComment(projectId: string, input: Record<string, unknown>): Promise<unknown> {
    const ticketId = stringInput(input, "ticketId");
    const ticket = requireTicket(this.dependencies.registry, projectId, ticketId);
    return this.dependencies.registry.updateTicket(projectId, ticketId, {
      comments: [...ticket.comments, {
        id: `comment-${randomUUID()}`,
        author: stringInput(input, "author"),
        body: stringInput(input, "body"),
        createdAt: new Date().toISOString()
      }]
    }, revisionInput(input));
  }

  #report(projectId: string, type: string, input: Record<string, unknown>): { revision: number; eventId: string } {
    const board = this.dependencies.registry.getBoard(projectId);
    assertRevision(board.revision, revisionInput(input));
    const payload = Object.fromEntries(Object.entries(input).filter(([key]) => key !== "projectRoot" && key !== "expectedRevision"));
    const event = this.dependencies.events.publish({ type, projectId, revision: board.revision, payload });
    return { revision: board.revision, eventId: event.id };
  }
}

function requireTicket(registry: ProjectRegistry, projectId: string, ticketId: string) {
  const ticket = registry.getBoard(projectId).tickets.find(candidate => candidate.id === ticketId);
  if (!ticket) throw new Error(`Ticket ${ticketId} was not found`);
  return ticket;
}

function objectInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Tool input must be an object");
  return value as Record<string, unknown>;
}

function stringInput(input: Record<string, unknown>, name: string): string {
  const value = input[name];
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} must be a non-empty string`);
  return value;
}

function revisionInput(input: Record<string, unknown>): number {
  const revision = input.expectedRevision;
  if (!Number.isInteger(revision) || (revision as number) < 0) throw new Error("expectedRevision must be a non-negative integer");
  return revision as number;
}

function statusInput(input: Record<string, unknown>): TicketStatus {
  const status = stringInput(input, "status");
  if (!["backlog", "todo", "in_progress", "review", "qa", "blocked", "done"].includes(status)) {
    throw new Error(`Unknown ticket status ${status}`);
  }
  return status as TicketStatus;
}

function assertRevision(actual: number, expected: number): void {
  if (actual !== expected) throw new StoreError("REVISION_CONFLICT", `Expected revision ${expected}, received ${actual}`);
}

function nonnegativeInteger(value: unknown, fallback: number): number {
  return Number.isInteger(value) && (value as number) >= 0 ? value as number : fallback;
}
