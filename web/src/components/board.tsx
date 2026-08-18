import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";

import type { ProjectConfig, Ticket, TicketStatus } from "../../../src/domain/types.js";
import type { RunnerRecord } from "../../../src/orchestration/runner-pool.js";
import { Column } from "./column.js";

export type BoardProps = {
  project: ProjectConfig;
  runners: RunnerRecord[];
  onMove(ticketId: string, status: TicketStatus, expectedRevision: number): Promise<void> | void;
  onOpenTicket(ticketId: string): void;
  compactCards?: boolean;
};

export function Board({ project, runners, onMove, onOpenTicket, compactCards = false }: BoardProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const handleDragEnd = (event: DragEndEvent) => {
    const status = event.over?.id;
    if (typeof status !== "string" || !project.board.columns.includes(status as TicketStatus)) return;
    const ticket = project.board.tickets.find(candidate => candidate.id === event.active.id);
    if (!ticket || !isHumanMovable(ticket.status) || ticket.status === status) return;
    void onMove(ticket.id, status as TicketStatus, project.board.revision);
  };
  const columns = project.board.columns.reduce<Array<{ status: TicketStatus; label?: string; tickets: Ticket[] }>>((result, status) => {
    if (status === "qa") return result;
    if (status === "review") {
      result.push({ status, label: "Review & QA", tickets: project.board.tickets.filter(ticket => ticket.status === "review" || ticket.status === "qa") });
      return result;
    }
    result.push({ status, tickets: project.board.tickets.filter(ticket => ticket.status === status) });
    return result;
  }, []);
  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
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
              compactCards={compactCards}
            />
          ))}
        </div>
      </div>
    </DndContext>
  );
}

function isHumanMovable(status: TicketStatus): boolean {
  return status === "backlog" || status === "blocked";
}
