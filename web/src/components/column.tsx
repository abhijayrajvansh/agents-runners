import { useDroppable } from "@dnd-kit/core";

import type { Ticket, TicketStatus } from "../../../src/domain/types.js";
import type { RunnerRecord } from "../../../src/orchestration/runner-pool.js";
import type { TicketDeliveryState } from "../../../src/runtime/project-runtime.js";
import { TicketCard } from "./ticket-card.js";

const labels: Record<TicketStatus, string> = {
  backlog: "Backlog",
  needs_triage: "Needs triage",
  needs_info: "Needs info",
  ready_for_agent: "Ready for agent",
  ready_for_human: "Ready for human",
  wontfix: "Won't fix",
  todo: "Todo",
  in_progress: "In progress",
  review: "Review",
  qa: "QA",
  blocked: "Blocked",
  done: "Done"
};

export type ColumnProps = {
  status: TicketStatus;
  tickets: Ticket[];
  allTickets: Ticket[];
  runners: RunnerRecord[];
  revision: number;
  onMove(ticketId: string, status: TicketStatus, expectedRevision: number): Promise<void> | void;
  onOpenTicket(ticketId: string): void;
  compactCards: boolean;
  label?: string;
  dragActive: boolean;
  manualDropTarget: boolean;
  deliveries: Record<string, TicketDeliveryState>;
  onMerge(ticketId: string): Promise<void> | void;
  mergeBranch: string;
};

export function Column({ status, tickets, allTickets, runners, revision, onMove, onOpenTicket, compactCards, label, dragActive, manualDropTarget, deliveries, onMerge, mergeBranch }: ColumnProps) {
  const droppable = useDroppable({ id: status, disabled: !manualDropTarget });
  const displayLabel = label ?? labels[status];
  return (
    <section
      ref={droppable.setNodeRef}
      className="board-column"
      data-over={droppable.isOver || undefined}
      data-manual-drop-target={manualDropTarget ? "true" : undefined}
      data-drop-disabled={dragActive && !manualDropTarget ? "true" : undefined}
      role="region"
      aria-label={displayLabel}
    >
      <header className="column-header">
        <div><span className={`status-dot status-dot--${status}`} />{displayLabel}</div>
        <span>{String(tickets.length).padStart(2, "0")}</span>
      </header>
      <div className="column-cards">
        {dragActive && manualDropTarget && <div className="column-drop-hint" data-over={droppable.isOver || undefined}>{droppable.isOver ? "Release to move" : "Drop ticket here"}</div>}
        {tickets.map(ticket => (
          <TicketCard
            key={ticket.id}
            ticket={ticket}
            runner={runners.find(runner => runner.ticketId === ticket.id)}
            revision={revision}
            onMove={onMove}
            onOpen={onOpenTicket}
            compact={compactCards}
            blockerKind={ticket.dependencies.some(id => allTickets.find(candidate => candidate.id === id)?.status !== "done") ? "dependency" : "human_input"}
            delivery={deliveries[ticket.id]}
            onMerge={onMerge}
            mergeBranch={mergeBranch}
          />
        ))}
        {tickets.length === 0 && <div className="column-empty">No tickets</div>}
      </div>
    </section>
  );
}
