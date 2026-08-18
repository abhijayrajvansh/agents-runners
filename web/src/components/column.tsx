import { useDroppable } from "@dnd-kit/core";

import type { Ticket, TicketStatus } from "../../../src/domain/types.js";
import type { RunnerRecord } from "../../../src/orchestration/runner-pool.js";
import { TicketCard } from "./ticket-card.js";

const labels: Record<TicketStatus, string> = {
  backlog: "Backlog",
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
  runners: RunnerRecord[];
  revision: number;
  onMove(ticketId: string, status: TicketStatus, expectedRevision: number): Promise<void> | void;
  onOpenTicket(ticketId: string): void;
  compactCards: boolean;
};

export function Column({ status, tickets, runners, revision, onMove, onOpenTicket, compactCards }: ColumnProps) {
  const droppable = useDroppable({ id: status });
  return (
    <section
      ref={droppable.setNodeRef}
      className="board-column"
      data-over={droppable.isOver || undefined}
      role="region"
      aria-label={labels[status]}
    >
      <header className="column-header">
        <div><span className={`status-dot status-dot--${status}`} />{labels[status]}</div>
        <span>{String(tickets.length).padStart(2, "0")}</span>
      </header>
      <div className="column-cards">
        {tickets.map(ticket => (
          <TicketCard
            key={ticket.id}
            ticket={ticket}
            runner={runners.find(runner => runner.ticketId === ticket.id)}
            revision={revision}
            onMove={onMove}
            onOpen={onOpenTicket}
            compact={compactCards}
          />
        ))}
        {tickets.length === 0 && <div className="column-empty">No tickets</div>}
      </div>
    </section>
  );
}
