import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";

import type { ProjectConfig, TicketStatus } from "../../../src/domain/types.js";
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
    if (!ticket || ticket.status === status) return;
    void onMove(ticket.id, status as TicketStatus, project.board.revision);
  };
  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="board-scroll" aria-label="Project delivery board">
        <div className="board-grid">
          {project.board.columns.map(status => (
            <Column
              key={status}
              status={status}
              tickets={project.board.tickets.filter(ticket => ticket.status === status)}
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
