import type { TicketStatus } from "../domain/types.js";

export type StageOutcome = {
  kind: "claimed" | "passed" | "failed" | "blocked";
  attempts: number;
  maxRetries: number;
};

const allowedTransitions: Record<TicketStatus, TicketStatus[]> = {
  backlog: ["todo"],
  todo: ["backlog", "in_progress", "blocked"],
  in_progress: ["backlog", "qa", "blocked"],
  qa: ["backlog", "in_progress", "review", "blocked"],
  review: ["backlog", "blocked"],
  blocked: ["backlog", "todo"]
};

export function nextStage(status: TicketStatus, outcome: StageOutcome): TicketStatus {
  if (outcome.kind === "blocked") return "blocked";
  if (outcome.kind === "failed") {
    return outcome.attempts >= outcome.maxRetries ? "blocked" : "in_progress";
  }
  if (outcome.kind === "claimed" && status === "todo") return "in_progress";
  if (outcome.kind === "passed") {
    if (status === "in_progress") return "qa";
    if (status === "qa") return "review";
  }
  throw new Error(`No ${outcome.kind} transition exists from ${status}`);
}

export function assertTransition(from: TicketStatus, to: TicketStatus): void {
  if (!allowedTransitions[from].includes(to)) {
    throw new Error(`Ticket transition from ${from} to ${to} is not allowed`);
  }
}
