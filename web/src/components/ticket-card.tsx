import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { ArrowRight, CircleDot, GripVertical } from "lucide-react";

import type { Ticket, TicketStatus } from "../../../src/domain/types.js";
import type { RunnerRecord } from "../../../src/orchestration/runner-pool.js";

const nextStatus: Partial<Record<TicketStatus, TicketStatus>> = {
  backlog: "todo",
  todo: "in_progress",
  in_progress: "review",
  review: "qa",
  qa: "done",
  blocked: "todo"
};

const statusLabels: Record<TicketStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In progress",
  review: "Review",
  qa: "QA",
  blocked: "Blocked",
  done: "Done"
};

export type TicketCardProps = {
  ticket: Ticket;
  runner: RunnerRecord | undefined;
  revision: number;
  onMove(ticketId: string, status: TicketStatus, expectedRevision: number): Promise<void> | void;
  onOpen(ticketId: string): void;
  compact: boolean;
};

export function TicketCard({ ticket, runner, revision, onMove, onOpen, compact }: TicketCardProps) {
  const draggable = useDraggable({ id: ticket.id, data: { ticket } });
  const upcoming = nextStatus[ticket.status];
  const style = {
    transform: CSS.Translate.toString(draggable.transform),
    opacity: draggable.isDragging ? 0.48 : 1
  };

  return (
    <article
      ref={draggable.setNodeRef}
      style={style}
      className="ticket-card"
      data-ticket-card
      data-compact={compact || undefined}
      data-priority={ticket.priority}
      onDoubleClick={event => {
        if ((event.target as HTMLElement).closest(".drag-handle, .ticket-next, .ticket-card__title")) return;
        onOpen(ticket.id);
      }}
    >
      <div className="ticket-card__meta">
        <span className="ticket-kind">{ticket.type}</span>
        <button
          className="drag-handle"
          type="button"
          aria-label={`Drag ${ticket.title}`}
          {...draggable.listeners}
          {...draggable.attributes}
        >
          <GripVertical size={14} strokeWidth={1.7} />
        </button>
      </div>
      <button
        className="ticket-card__title"
        type="button"
        aria-label={`Open ${ticket.title}`}
        onClick={() => onOpen(ticket.id)}
        onKeyDown={event => { if (event.key === "Enter") onOpen(ticket.id); }}
      >
        {ticket.title}
      </button>
      {ticket.status === "blocked" && (
        <span
          className={`blocker-tag blocker-tag--${ticket.blocker?.kind ?? "human_input"}`}
          title={ticket.blocker?.reason}
        >
          {ticket.blocker?.kind === "dependency" ? "Waiting for tickets" : "Needs human input"}
        </span>
      )}
      {!compact && ticket.description && <p>{ticket.description}</p>}
      {!compact && <div className="ticket-card__footer">
          <span className="priority-label"><CircleDot size={11} />{ticket.priority}</span>
          {runner ? <span className="runner-pill">{runner.id.replace("-", " ")}</span> : <span className="unassigned">Unassigned</span>}
        </div>}
      {!compact && upcoming && (
        <button
          type="button"
          className="ticket-next"
          aria-label={`Move ${ticket.title} to ${statusLabels[upcoming]}`}
          onClick={() => void onMove(ticket.id, upcoming, revision)}
        >
          {statusLabels[upcoming]} <ArrowRight size={13} />
        </button>
      )}
    </article>
  );
}
