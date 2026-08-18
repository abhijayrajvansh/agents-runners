import { useCallback, useEffect, useRef, useState } from "react";

import type { ProjectConfig, RoleName, Ticket, TicketStatus } from "../../../src/domain/types.js";
import type { RunnerRecord } from "../../../src/orchestration/runner-pool.js";
import type { DonnaConversationMessage } from "../../../src/runtime/project-runtime.js";
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
  models: CodexModelOption[];
  connected: boolean;
  loading: boolean;
  error: string | null;
  refresh(): Promise<void>;
  moveTicket(ticketId: string, status: TicketStatus, expectedRevision: number): Promise<void>;
  saveTicket(ticket: Partial<Ticket> & { id?: string }): Promise<void>;
  setPoolMaximum(role: RoleName, maximum: number): Promise<void>;
  setDonnaModel(model: string): Promise<void>;
  messageDonna(message: string): Promise<string>;
};

export function useProject(projectId: string, api = defaultApi): ProjectState {
  const [project, setProject] = useState<ProjectConfig | null>(null);
  const [runners, setRunners] = useState<RunnerRecord[]>([]);
  const [activity, setActivity] = useState<ProjectEvent[]>([]);
  const [donnaMessages, setDonnaMessages] = useState<DonnaConversationMessage[]>([]);
  const [models, setModels] = useState<CodexModelOption[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const [nextProject, nextRunners, nextDonnaMessages, nextModels] = await Promise.all([
        api.getProject(projectId),
        api.listRunners(projectId),
        api.getDonnaMessages(projectId),
        api.listModels()
      ]);
      setProject(nextProject);
      setRunners(nextRunners);
      setDonnaMessages(nextDonnaMessages);
      setModels(nextModels);
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
    if (event.type === "config.error" && typeof event.payload.message === "string") setError(event.payload.message);
    if (event.type === "donna.user" || event.type === "donna.completed" || event.type === "donna.blocker") {
      void api.getDonnaMessages(projectId).then(setDonnaMessages);
    }
    if (event.type.startsWith("ticket.") || event.type.startsWith("runner.") || event.type === "project.updated") {
      void refresh();
    }
  }, setConnected), [api, projectId, refresh]);

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
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      throw caught;
    } finally {
      setDonnaMessages(await api.getDonnaMessages(projectId));
    }
  }, [api, projectId]);

  return { project, runners, activity, donnaMessages, models, connected, loading, error, refresh, moveTicket, saveTicket, setPoolMaximum, setDonnaModel, messageDonna };
}
