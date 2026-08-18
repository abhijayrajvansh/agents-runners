import { useCallback, useEffect, useRef, useState } from "react";

import type { ProjectConfig, Ticket, TicketStatus } from "../../../src/domain/types.js";
import type { RunnerRecord } from "../../../src/orchestration/runner-pool.js";
import type { ProjectEvent } from "../../../src/server/event-bus.js";
import { RunnersApi } from "../api/client.js";
import { connectProjectSocket } from "../api/socket.js";

const defaultApi = new RunnersApi();

export type ProjectState = {
  project: ProjectConfig | null;
  runners: RunnerRecord[];
  activity: ProjectEvent[];
  connected: boolean;
  loading: boolean;
  error: string | null;
  refresh(): Promise<void>;
  moveTicket(ticketId: string, status: TicketStatus, expectedRevision: number): Promise<void>;
  saveTicket(ticket: Partial<Ticket> & { id?: string }): Promise<void>;
  messageDonna(message: string): Promise<string>;
};

export function useProject(projectId: string, api = defaultApi): ProjectState {
  const [project, setProject] = useState<ProjectConfig | null>(null);
  const [runners, setRunners] = useState<RunnerRecord[]>([]);
  const [activity, setActivity] = useState<ProjectEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const [nextProject, nextRunners] = await Promise.all([
        api.getProject(projectId),
        api.listRunners(projectId)
      ]);
      setProject(nextProject);
      setRunners(nextRunners);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [api, projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => connectProjectSocket(projectId, sequence.current, event => {
    sequence.current = Math.max(sequence.current, event.sequence);
    setActivity(current => [...current, event].slice(-80));
    if (event.type.startsWith("ticket.") || event.type.startsWith("runner.") || event.type === "project.updated") {
      void refresh();
    }
  }, setConnected), [projectId, refresh]);

  const moveTicket = useCallback(async (ticketId: string, status: TicketStatus, expectedRevision: number) => {
    const snapshot = project;
    if (!snapshot) return;
    setProject({
      ...snapshot,
      board: {
        ...snapshot.board,
        tickets: snapshot.board.tickets.map(ticket => ticket.id === ticketId ? { ...ticket, status } : ticket)
      }
    });
    try {
      await api.moveTicket(projectId, ticketId, status, expectedRevision);
      await refresh();
    } catch (caught) {
      setProject(snapshot);
      setError(caught instanceof Error ? caught.message : String(caught));
      await refresh();
    }
  }, [api, project, projectId, refresh]);

  const saveTicket = useCallback(async (ticket: Partial<Ticket> & { id?: string }) => {
    if (!project) return;
    if (ticket.id && project.board.tickets.some(candidate => candidate.id === ticket.id)) {
      const { id, ...patch } = ticket;
      await api.updateTicket(projectId, id, patch, project.board.revision);
    } else {
      await api.createTicket(projectId, ticket, project.board.revision);
    }
    await refresh();
  }, [api, project, projectId, refresh]);

  const messageDonna = useCallback((message: string) => api.messageDonna(projectId, message), [api, projectId]);

  return { project, runners, activity, connected, loading, error, refresh, moveTicket, saveTicket, messageDonna };
}
