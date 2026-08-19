import type { TicketStatus } from "../domain/types.js";

export type StageOutcome = {
  kind: "claimed" | "passed" | "failed" | "blocked";
  attempts: number;
  maxRetries: number;
};

const allowedTransitions: Record<TicketStatus, TicketStatus[]> = {
  backlog: ["todo"],
  needs_triage: ["needs_info", "ready_for_agent", "ready_for_human", "wontfix", "backlog"],
  needs_info: ["needs_triage", "needs_info", "ready_for_agent", "ready_for_human", "wontfix"],
  ready_for_agent: ["backlog", "in_progress", "blocked"],
  ready_for_human: ["backlog", "ready_for_agent", "blocked"],
  wontfix: [],
  todo: ["backlog", "in_progress", "blocked", "ready_for_agent"],
  in_progress: ["backlog", "review", "blocked"],
  review: ["backlog", "in_progress", "qa", "blocked"],
  qa: ["backlog", "in_progress", "done", "blocked"],
  blocked: ["backlog", "todo", "ready_for_agent"],
  done: []
};

export function nextStage(status: TicketStatus, outcome: StageOutcome): TicketStatus {
  if (outcome.kind === "blocked") return "blocked";
  if (outcome.kind === "failed") {
    return outcome.attempts >= outcome.maxRetries ? "blocked" : "in_progress";
  }
  if (outcome.kind === "claimed" && (status === "todo" || status === "ready_for_agent")) return "in_progress";
  if (outcome.kind === "passed") {
    if (status === "in_progress") return "review";
    if (status === "review") return "qa";
    if (status === "qa") return "done";
  }
  throw new Error(`No ${outcome.kind} transition exists from ${status}`);
}

export function assertTransition(from: TicketStatus, to: TicketStatus): void {
  if (!allowedTransitions[from].includes(to)) {
    throw new Error(`Ticket transition from ${from} to ${to} is not allowed`);
  }
}
