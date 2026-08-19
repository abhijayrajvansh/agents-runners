import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { ArrowRight, Check, CircleDot, GitMerge, GripVertical, LoaderCircle, RotateCcw } from "lucide-react";

import type { Ticket, TicketStatus } from "../../../src/domain/types.js";
import type { RunnerRecord } from "../../../src/orchestration/runner-pool.js";
import type { TicketDeliveryState } from "../../../src/runtime/project-runtime.js";

const nextStatus: Partial<Record<TicketStatus, TicketStatus>> = {
  backlog: "todo",
  needs_triage: "ready_for_agent",
  needs_info: "needs_triage",
  todo: "in_progress",
  in_progress: "review",
  review: "qa",
  qa: "done",
  blocked: "ready_for_agent",
  ready_for_human: "ready_for_agent"
};

const statusLabels: Record<TicketStatus, string> = {
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

export type TicketCardProps = {
  ticket: Ticket;
  runner: RunnerRecord | undefined;
  revision: number;
  onMove(ticketId: string, status: TicketStatus, expectedRevision: number): Promise<void> | void;
  onOpen(ticketId: string): void;
  compact: boolean;
  blockerKind?: "dependency" | "human_input";
  delivery?: TicketDeliveryState | undefined;
  onMerge(ticketId: string): Promise<void> | void;
  mergeBranch: string;
};

export function TicketCard({ ticket, runner, revision, onMove, onOpen, compact, blockerKind, delivery, onMerge, mergeBranch }: TicketCardProps) {
  const humanMovable = ["backlog", "needs_triage", "needs_info", "ready_for_human", "wontfix", "blocked"].includes(ticket.status);
  const draggable = useDraggable({ id: ticket.id, data: { ticket }, disabled: !humanMovable });
  const upcoming = humanMovable ? nextStatus[ticket.status] : undefined;
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
        <div className="ticket-card__identity">
          <span className="ticket-id" title={ticket.id}>{ticket.id}</span>
          {compact && runner && <span className="runner-pill">{runner.id.replace("-", " ")}</span>}
        </div>
        {humanMovable && (
          <button
            className="drag-handle"
            type="button"
            aria-label={`Drag ${ticket.title}`}
            {...draggable.listeners}
            {...draggable.attributes}
          >
            <GripVertical size={14} strokeWidth={1.7} />
          </button>
        )}
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
          className={`blocker-tag blocker-tag--${ticket.blocker?.kind ?? blockerKind ?? "human_input"}`}
          title={ticket.blocker?.reason}
        >
          {(ticket.blocker?.kind ?? blockerKind) === "dependency" ? "Waiting for tickets" : "Needs human input"}
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
      {ticket.status === "done" && delivery?.mergeState === "ready" && (
        <button type="button" className="ticket-merge" onClick={() => void onMerge(ticket.id)}>
          <GitMerge size={13} /> Merge to {mergeBranch}
        </button>
      )}
      {ticket.status === "done" && delivery?.mergeState === "merging" && (
        <button type="button" className="ticket-merge" disabled><LoaderCircle className="spin" size={13} /> Merging…</button>
      )}
      {ticket.status === "done" && delivery?.mergeState === "failed" && (
        <button type="button" className="ticket-merge ticket-merge--retry" title={delivery.mergeError} onClick={() => void onMerge(ticket.id)}>
          <RotateCcw size={13} /> Retry merge
        </button>
      )}
      {ticket.status === "done" && delivery?.mergeState === "merged" && (
        <div className="ticket-merged"><Check size={13} /> Merged</div>
      )}
    </article>
  );
}
