import { useState } from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent
} from "@dnd-kit/core";

import type { ProjectConfig, Ticket, TicketStatus } from "../../../src/domain/types.js";
import type { RunnerRecord } from "../../../src/orchestration/runner-pool.js";
import type { TicketDeliveryState } from "../../../src/runtime/project-runtime.js";
import { Column } from "./column.js";

export type BoardProps = {
  project: ProjectConfig;
  runners: RunnerRecord[];
  onMove(ticketId: string, status: TicketStatus, expectedRevision: number): Promise<void> | void;
  onOpenTicket(ticketId: string): void;
  compactCards?: boolean;
  deliveries?: Record<string, TicketDeliveryState>;
  onMerge?(ticketId: string): Promise<void> | void;
};

export function Board({ project, runners, onMove, onOpenTicket, compactCards = false, deliveries = {}, onMerge = () => undefined }: BoardProps) {
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  );
  const handleDragStart = (event: DragStartEvent) => {
    const ticket = project.board.tickets.find(candidate => candidate.id === event.active.id);
    setActiveTicketId(ticket && isHumanMovable(ticket.status) ? ticket.id : null);
  };
  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTicketId(null);
    const status = event.over?.id;
    if (typeof status !== "string" || !project.board.columns.includes(status as TicketStatus) || !isManualDropTarget(status as TicketStatus)) return;
    const ticket = project.board.tickets.find(candidate => candidate.id === event.active.id);
    if (!ticket || !isHumanMovable(ticket.status) || ticket.status === status) return;
    void onMove(ticket.id, status as TicketStatus, project.board.revision);
  };
  const columns = project.board.columns.reduce<Array<{ status: TicketStatus; label?: string; tickets: Ticket[] }>>((result, status) => {
    result.push({ status, tickets: project.board.tickets.filter(ticket => ticket.status === status) });
    return result;
  }, []);
  const activeTicket = project.board.tickets.find(ticket => ticket.id === activeTicketId);
  return (
    <DndContext sensors={sensors} collisionDetection={magneticCollisionDetection} onDragStart={handleDragStart} onDragCancel={() => setActiveTicketId(null)} onDragEnd={handleDragEnd}>
      <div className="board-scroll" aria-label="Project delivery board">
        <div className="board-grid">
          {columns.map(column => (
            <Column
              key={column.status}
              status={column.status}
              tickets={column.tickets}
              {...(column.label ? { label: column.label } : {})}
              allTickets={project.board.tickets}
              runners={runners}
              revision={project.board.revision}
              onMove={onMove}
              onOpenTicket={onOpenTicket}
              deliveries={deliveries}
              onMerge={onMerge}
              mergeBranch={project.project.integrationBranch}
              compactCards={compactCards}
              dragActive={Boolean(activeTicket)}
              manualDropTarget={isManualDropTarget(column.status)}
            />
          ))}
        </div>
      </div>
      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(.2,.8,.2,1)" }}>
        {activeTicket ? <TicketDragPreview ticket={activeTicket} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function isHumanMovable(status: TicketStatus): boolean {
  return ["backlog", "needs_triage", "needs_info", "ready_for_human", "wontfix", "blocked"].includes(status);
}

function isManualDropTarget(status: TicketStatus): boolean {
  return ["backlog", "needs_triage", "needs_info", "ready_for_agent", "ready_for_human", "wontfix", "blocked"].includes(status);
}

const magneticCollisionDetection: CollisionDetection = arguments_ => {
  const pointer = pointerWithin(arguments_);
  return pointer.length > 0 ? pointer : closestCenter(arguments_);
};

function TicketDragPreview({ ticket }: { ticket: Ticket }) {
  return (
    <div className="ticket-drag-preview">
      <span>{ticket.id}</span>
      <strong>{ticket.title}</strong>
      <small>Move through triage or to Ready for agent</small>
    </div>
  );
}
