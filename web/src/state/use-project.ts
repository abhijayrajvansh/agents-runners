import { useCallback, useEffect, useRef, useState } from "react";

import type { ProjectConfig, RoleName, Ticket, TicketStatus } from "../../../src/domain/types.js";
import type { RunnerRecord } from "../../../src/orchestration/runner-pool.js";
import type { DonnaConversationMessage, DonnaSession, TicketDeliveryState } from "../../../src/runtime/project-runtime.js";
import type { ProjectEvent } from "../../../src/server/event-bus.js";
import type { CodexModelOption } from "../../../src/runners/codex-models.js";
import { RunnersApi } from "../api/client.js";
import { connectProjectSocket } from "../api/socket.js";

const defaultApi = new RunnersApi();

export type ProjectState = {
  project: ProjectConfig | null;
  runners: RunnerRecord[];
  activity: ProjectEvent[];
  donnaMessages: DonnaConversationMessage[];
  donnaSessions: DonnaSession[];
  donnaSessionId: string;
  models: CodexModelOption[];
  deliveries: Record<string, TicketDeliveryState>;
  connected: boolean;
  loading: boolean;
  error: string | null;
  refresh(): Promise<void>;
  moveTicket(ticketId: string, status: TicketStatus, expectedRevision: number): Promise<void>;
  saveTicket(ticket: Partial<Ticket> & { id?: string }): Promise<void>;
  setPoolMaximum(role: RoleName, maximum: number): Promise<void>;
  setDonnaModel(model: string): Promise<void>;
  messageDonna(message: string): Promise<string>;
  selectDonnaSession(sessionId: string): Promise<void>;
  newDonnaSession(): Promise<void>;
  resetDonnaSession(): Promise<void>;
  mergeTicket(ticketId: string): Promise<void>;
  abortTicket(ticketId: string): Promise<void>;
};

export function useProject(projectId: string, api = defaultApi): ProjectState {
  const [project, setProject] = useState<ProjectConfig | null>(null);
  const [runners, setRunners] = useState<RunnerRecord[]>([]);
  const [activity, setActivity] = useState<ProjectEvent[]>([]);
  const [donnaMessages, setDonnaMessages] = useState<DonnaConversationMessage[]>([]);
  const [donnaSessions, setDonnaSessions] = useState<DonnaSession[]>([]);
  const [donnaSessionId, setDonnaSessionId] = useState(() => localStorage.getItem(`codex-runners:donna-session:${projectId}`) ?? "default");
  const [models, setModels] = useState<CodexModelOption[]>([]);
  const [deliveries, setDeliveries] = useState<Record<string, TicketDeliveryState>>({});
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const lastSocketEventAt = useRef(0);
  const refreshing = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const [nextProject, nextRunners, nextSessions, nextModels, nextDeliveries] = await Promise.all([
        api.getProject(projectId),
        api.listRunners(projectId),
        api.listDonnaSessions(projectId),
        api.listModels(),
        api.listDeliveries(projectId)
      ]);
      const activeSessionId = nextSessions.some(session => session.id === donnaSessionId)
        ? donnaSessionId
        : nextSessions[0]?.id ?? "default";
      const nextDonnaMessages = await api.getDonnaMessages(projectId, activeSessionId);
      setProject(nextProject);
      setRunners(nextRunners);
      setDonnaSessions(nextSessions);
      setDonnaSessionId(activeSessionId);
      setDonnaMessages(nextDonnaMessages);
      setModels(nextModels);
      setDeliveries(nextDeliveries);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
      refreshing.current = false;
    }
  }, [api, donnaSessionId, projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    lastSocketEventAt.current = Date.now();
    return connectProjectSocket(projectId, sequence.current, event => {
      lastSocketEventAt.current = Date.now();
      sequence.current = Math.max(sequence.current, event.sequence);
      setActivity(current => [...current, event].slice(-80));
      if (event.type === "config.error" && typeof event.payload.message === "string") setError(event.payload.message);
      if (event.type === "donna.user" || event.type === "donna.completed" || event.type === "donna.blocker") {
        void api.getDonnaMessages(projectId, donnaSessionId).then(setDonnaMessages);
      }
      if (event.type.startsWith("ticket.") || event.type.startsWith("runner.") || event.type === "project.updated") {
        void refresh();
      }
    }, setConnected);
  }, [api, donnaSessionId, projectId, refresh]);

  useEffect(() => {
    const poll = setInterval(() => {
      const stale = Date.now() - lastSocketEventAt.current > 5_000;
      if (!connected || stale) void refresh();
    }, 2_000);
    return () => clearInterval(poll);
  }, [connected, refresh]);

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

  const setPoolMaximum = useCallback(async (role: RoleName, maximum: number) => {
    if (!project) return;
    await api.updatePoolMaximum(projectId, role, maximum, project.board.revision);
    await refresh();
  }, [api, project, projectId, refresh]);

  const setDonnaModel = useCallback(async (model: string) => {
    if (!project) return;
    await api.updateDonnaModel(projectId, model, project.board.revision);
    await refresh();
  }, [api, project, projectId, refresh]);

  const messageDonna = useCallback(async (message: string) => {
    setDonnaMessages(current => [...current, {
      id: crypto.randomUUID(),
      author: "user",
      text: message,
      source: "browser",
      createdAt: new Date().toISOString()
    }]);
    try {
      return await api.messageDonna(projectId, message, event => {
        if (event.type !== "message") return;
        setDonnaMessages(current => [...current, {
          id: crypto.randomUUID(),
          author: "donna",
          text: event.text,
          source: "browser",
          createdAt: new Date().toISOString()
        }]);
      }, donnaSessionId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      throw caught;
    } finally {
      try {
        setDonnaMessages(await api.getDonnaMessages(projectId, donnaSessionId));
      } catch {
        // Preserve the original chat error and let polling recover the persisted history.
      }
    }
  }, [api, donnaSessionId, projectId]);

  const selectDonnaSession = useCallback(async (sessionId: string) => {
    setDonnaSessionId(sessionId);
    localStorage.setItem(`codex-runners:donna-session:${projectId}`, sessionId);
    setDonnaMessages(await api.getDonnaMessages(projectId, sessionId));
  }, [api, projectId]);

  const newDonnaSession = useCallback(async () => {
    const session = await api.createDonnaSession(projectId);
    setDonnaSessions(current => [...current, session]);
    setDonnaSessionId(session.id);
    localStorage.setItem(`codex-runners:donna-session:${projectId}`, session.id);
    setDonnaMessages([]);
  }, [api, projectId]);

  const resetDonnaSession = useCallback(async () => {
    await api.resetDonnaSession(projectId, donnaSessionId);
    setDonnaMessages([]);
  }, [api, donnaSessionId, projectId]);

  const mergeTicket = useCallback(async (ticketId: string) => {
    setDeliveries(current => {
      const { mergeError: _mergeError, ...delivery } = current[ticketId] ?? {};
      return { ...current, [ticketId]: { ...delivery, mergeState: "merging" } };
    });
    try {
      await api.mergeTicket(projectId, ticketId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      await refresh();
    }
  }, [api, projectId, refresh]);

  const abortTicket = useCallback(async (ticketId: string) => {
    if (!project) return;
    try {
      await api.abortTicket(projectId, ticketId, project.board.revision);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      throw caught;
    } finally {
      await refresh();
    }
  }, [api, project, projectId, refresh]);

  return { project, runners, activity, donnaMessages, donnaSessions, donnaSessionId, models, deliveries, connected, loading, error, refresh, moveTicket, saveTicket, setPoolMaximum, setDonnaModel, messageDonna, selectDonnaSession, newDonnaSession, resetDonnaSession, mergeTicket, abortTicket };
}
