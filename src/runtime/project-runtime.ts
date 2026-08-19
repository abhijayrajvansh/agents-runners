import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export type TicketRuntimeState = {
  attempts: number;
  findings: string[];
  developerRunnerId?: string;
  reviewerRunnerId?: string;
  qaRunnerId?: string;
  integrationCommit?: string;
  deliveryBranch?: string;
  mergeState?: "ready" | "merging" | "merged" | "failed";
  mergeError?: string;
};

export type TicketDeliveryState = Pick<TicketRuntimeState,
  "deliveryBranch" | "integrationCommit" | "mergeState" | "mergeError"
>;

export type DonnaConversationMessage = {
  id: string;
  author: "user" | "donna";
  text: string;
  source: "browser" | "terminal" | "mcp";
  createdAt: string;
};

export type DonnaSession = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export interface ProjectRuntimeRepository {
  getTicket(projectId: string, ticketId: string): TicketRuntimeState;
  setTicket(projectId: string, ticketId: string, state: TicketRuntimeState): void;
  getDonnaThread(projectId: string, sessionId?: string): string | undefined;
  setDonnaThread(projectId: string, threadId: string, sessionId?: string): void;
  clearDonnaThread(projectId: string, sessionId?: string): void;
  getDonnaMessages(projectId: string, sessionId?: string): DonnaConversationMessage[];
  appendDonnaMessage(projectId: string, message: Omit<DonnaConversationMessage, "id" | "createdAt">, sessionId?: string): DonnaConversationMessage;
  listDonnaSessions(projectId: string): DonnaSession[];
  createDonnaSession(projectId: string, title?: string): DonnaSession;
  clearDonnaSession(projectId: string, sessionId: string): void;
  getBlockerNotification(projectId: string, ticketId: string): string | undefined;
  setBlockerNotification(projectId: string, ticketId: string, ticketUpdatedAt: string): void;
  getRunnerThread(projectId: string, runnerId: string): string | undefined;
  setRunnerThread(projectId: string, runnerId: string, threadId: string): void;
}

export class MemoryProjectRuntime implements ProjectRuntimeRepository {
  #tickets = new Map<string, TicketRuntimeState>();
  #donnaThreads = new Map<string, string>();
  #donnaMessages = new Map<string, DonnaConversationMessage[]>();
  #donnaSessions = new Map<string, DonnaSession[]>();
  #blockerNotifications = new Map<string, string>();
  #runnerThreads = new Map<string, string>();

  getTicket(projectId: string, ticketId: string): TicketRuntimeState {
    return this.#tickets.get(key(projectId, ticketId)) ?? { attempts: 0, findings: [] };
  }

  setTicket(projectId: string, ticketId: string, state: TicketRuntimeState): void {
    this.#tickets.set(key(projectId, ticketId), structuredClone(state));
  }

  getDonnaThread(projectId: string, sessionId = "default"): string | undefined {
    return this.#donnaThreads.get(sessionKey(projectId, sessionId));
  }

  setDonnaThread(projectId: string, threadId: string, sessionId = "default"): void {
    this.#donnaThreads.set(sessionKey(projectId, sessionId), threadId);
  }

  clearDonnaThread(projectId: string, sessionId = "default"): void {
    this.#donnaThreads.delete(sessionKey(projectId, sessionId));
  }

  getDonnaMessages(projectId: string, sessionId = "default"): DonnaConversationMessage[] {
    return structuredClone(this.#donnaMessages.get(sessionKey(projectId, sessionId)) ?? []);
  }

  appendDonnaMessage(projectId: string, message: Omit<DonnaConversationMessage, "id" | "createdAt">, sessionId = "default"): DonnaConversationMessage {
    const stored = { ...message, id: randomUUID(), createdAt: new Date().toISOString() };
    const keyName = sessionKey(projectId, sessionId);
    this.#donnaMessages.set(keyName, [...(this.#donnaMessages.get(keyName) ?? []), stored]);
    return structuredClone(stored);
  }

  listDonnaSessions(projectId: string): DonnaSession[] {
    const existing = this.#donnaSessions.get(projectId);
    if (existing?.length) return structuredClone(existing);
    const messages = this.getDonnaMessages(projectId);
    const now = new Date(0).toISOString();
    return [{ id: "default", title: "Main chat", createdAt: messages[0]?.createdAt ?? now, updatedAt: messages.at(-1)?.createdAt ?? now }];
  }

  createDonnaSession(projectId: string, title = "New chat"): DonnaSession {
    const now = new Date().toISOString();
    const session = { id: `donna-${randomUUID()}`, title: title.trim() || "New chat", createdAt: now, updatedAt: now };
    this.#donnaSessions.set(projectId, [...this.listDonnaSessions(projectId), session]);
    return structuredClone(session);
  }

  clearDonnaSession(projectId: string, sessionId: string): void {
    this.clearDonnaThread(projectId, sessionId);
    this.#donnaMessages.delete(sessionKey(projectId, sessionId));
    const sessions = this.listDonnaSessions(projectId);
    this.#donnaSessions.set(projectId, sessions.map(session => session.id === sessionId
      ? { ...session, updatedAt: new Date().toISOString() }
      : session));
  }

  getBlockerNotification(projectId: string, ticketId: string): string | undefined {
    return this.#blockerNotifications.get(key(projectId, ticketId));
  }

  setBlockerNotification(projectId: string, ticketId: string, ticketUpdatedAt: string): void {
    this.#blockerNotifications.set(key(projectId, ticketId), ticketUpdatedAt);
  }

  getRunnerThread(projectId: string, runnerId: string): string | undefined {
    return this.#runnerThreads.get(key(projectId, runnerId));
  }

  setRunnerThread(projectId: string, runnerId: string, threadId: string): void {
    this.#runnerThreads.set(key(projectId, runnerId), threadId);
  }
}

type RuntimeDocument = {
  version: 1;
  tickets: Record<string, TicketRuntimeState>;
  donnaThreads: Record<string, string>;
  donnaMessages: Record<string, DonnaConversationMessage[]>;
  donnaSessions: Record<string, DonnaSession[]>;
  blockerNotifications: Record<string, string>;
  runnerThreads: Record<string, string>;
};

export class JsonProjectRuntime implements ProjectRuntimeRepository {
  readonly filePath: string;
  #document: RuntimeDocument;

  constructor(runtimeDirectory: string) {
    this.filePath = path.join(runtimeDirectory, "project-runtime.json");
    this.#document = this.#load();
  }

  getTicket(projectId: string, ticketId: string): TicketRuntimeState {
    return structuredClone(this.#document.tickets[key(projectId, ticketId)] ?? { attempts: 0, findings: [] });
  }

  setTicket(projectId: string, ticketId: string, state: TicketRuntimeState): void {
    this.#document.tickets[key(projectId, ticketId)] = structuredClone(state);
    this.#persist();
  }

  getDonnaThread(projectId: string, sessionId = "default"): string | undefined {
    return this.#document.donnaThreads[sessionKey(projectId, sessionId)];
  }

  setDonnaThread(projectId: string, threadId: string, sessionId = "default"): void {
    this.#document.donnaThreads[sessionKey(projectId, sessionId)] = threadId;
    this.#persist();
  }

  clearDonnaThread(projectId: string, sessionId = "default"): void {
    delete this.#document.donnaThreads[sessionKey(projectId, sessionId)];
    this.#persist();
  }

  getDonnaMessages(projectId: string, sessionId = "default"): DonnaConversationMessage[] {
    return structuredClone(this.#document.donnaMessages[sessionKey(projectId, sessionId)] ?? []);
  }

  appendDonnaMessage(projectId: string, message: Omit<DonnaConversationMessage, "id" | "createdAt">, sessionId = "default"): DonnaConversationMessage {
    const stored = { ...message, id: randomUUID(), createdAt: new Date().toISOString() };
    const keyName = sessionKey(projectId, sessionId);
    this.#document.donnaMessages[keyName] = [...(this.#document.donnaMessages[keyName] ?? []), stored].slice(-500);
    this.#touchDonnaSession(projectId, sessionId, stored.createdAt);
    this.#persist();
    return structuredClone(stored);
  }

  listDonnaSessions(projectId: string): DonnaSession[] {
    const existing = this.#document.donnaSessions[projectId];
    if (existing?.length) return structuredClone(existing);
    const messages = this.getDonnaMessages(projectId);
    const now = new Date(0).toISOString();
    return [{ id: "default", title: "Main chat", createdAt: messages[0]?.createdAt ?? now, updatedAt: messages.at(-1)?.createdAt ?? now }];
  }

  createDonnaSession(projectId: string, title = "New chat"): DonnaSession {
    const now = new Date().toISOString();
    const session = { id: `donna-${randomUUID()}`, title: title.trim() || "New chat", createdAt: now, updatedAt: now };
    this.#document.donnaSessions[projectId] = [...this.listDonnaSessions(projectId), session];
    this.#persist();
    return structuredClone(session);
  }

  clearDonnaSession(projectId: string, sessionId: string): void {
    this.clearDonnaThread(projectId, sessionId);
    delete this.#document.donnaMessages[sessionKey(projectId, sessionId)];
    const now = new Date().toISOString();
    this.#document.donnaSessions[projectId] = this.listDonnaSessions(projectId).map(session => (
      session.id === sessionId ? { ...session, updatedAt: now } : session
    ));
    this.#persist();
  }

  getBlockerNotification(projectId: string, ticketId: string): string | undefined {
    return this.#document.blockerNotifications[key(projectId, ticketId)];
  }

  setBlockerNotification(projectId: string, ticketId: string, ticketUpdatedAt: string): void {
    this.#document.blockerNotifications[key(projectId, ticketId)] = ticketUpdatedAt;
    this.#persist();
  }

  getRunnerThread(projectId: string, runnerId: string): string | undefined {
    return this.#document.runnerThreads[key(projectId, runnerId)];
  }

  setRunnerThread(projectId: string, runnerId: string, threadId: string): void {
    this.#document.runnerThreads[key(projectId, runnerId)] = threadId;
    this.#persist();
  }

  #persist(): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(this.#document, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, this.filePath);
  }

  #touchDonnaSession(projectId: string, sessionId: string, updatedAt: string): void {
    const sessions = this.listDonnaSessions(projectId);
    const current = sessions.find(session => session.id === sessionId);
    if (current) current.updatedAt = updatedAt;
    else sessions.push({ id: sessionId, title: sessionId === "default" ? "Main chat" : "New chat", createdAt: updatedAt, updatedAt });
    this.#document.donnaSessions[projectId] = sessions;
  }

  #load(): RuntimeDocument {
    if (!existsSync(this.filePath)) return { version: 1, tickets: {}, donnaThreads: {}, donnaMessages: {}, donnaSessions: {}, blockerNotifications: {}, runnerThreads: {} };
    const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<RuntimeDocument>;
    if (parsed.version !== 1 || !parsed.tickets || typeof parsed.tickets !== "object") {
      throw new Error(`Invalid Codex Runners runtime document at ${this.filePath}`);
    }
    return {
      version: 1,
      tickets: parsed.tickets,
      donnaThreads: parsed.donnaThreads ?? {},
      donnaMessages: parsed.donnaMessages ?? loadLegacyDonnaMessages(path.dirname(this.filePath)),
      donnaSessions: parsed.donnaSessions ?? {},
      blockerNotifications: parsed.blockerNotifications ?? {},
      runnerThreads: parsed.runnerThreads ?? {}
    };
  }
}

function sessionKey(projectId: string, sessionId: string): string {
  return sessionId === "default" ? projectId : `${projectId}:${sessionId}`;
}

function key(projectId: string, ticketId: string): string {
  return `${projectId}:${ticketId}`;
}

function loadLegacyDonnaMessages(runtimeDirectory: string): Record<string, DonnaConversationMessage[]> {
  const donnaDirectory = path.join(runtimeDirectory, "donna");
  if (!existsSync(donnaDirectory)) return {};
  try {
    const turns = readdirSync(donnaDirectory)
      .filter(file => file.endsWith(".input"))
      .map(file => {
        const stem = file.slice(0, -".input".length);
        const inputPath = path.join(donnaDirectory, file);
        const eventsPath = path.join(donnaDirectory, `${stem}.events.jsonl`);
        if (!existsSync(eventsPath)) return null;
        const prompt = readFileSync(inputPath, "utf8");
        const marker = "\n\nUser message:\n";
        const markerIndex = prompt.lastIndexOf(marker);
        const userText = markerIndex >= 0 ? prompt.slice(markerIndex + marker.length).trim() : "";
        const assistantText = readFileSync(eventsPath, "utf8")
          .split(/\r?\n/)
          .filter(Boolean)
          .map(line => {
            try {
              const event = JSON.parse(line) as { type?: unknown; item?: { type?: unknown; text?: unknown } };
              return event.type === "item.completed" && event.item?.type === "agent_message" && typeof event.item.text === "string"
                ? event.item.text
                : "";
            } catch {
              return "";
            }
          })
          .filter(Boolean)
          .at(-1) ?? "";
        if (!userText || !assistantText) return null;
        return { userText, assistantText, timestamp: statSync(inputPath).mtimeMs };
      })
      .filter((turn): turn is { userText: string; assistantText: string; timestamp: number } => turn !== null)
      .sort((left, right) => left.timestamp - right.timestamp);
    if (turns.length === 0) return {};
    const messages = turns.flatMap(turn => [
      {
        id: randomUUID(),
        author: "user" as const,
        text: turn.userText,
        source: "browser" as const,
        createdAt: new Date(turn.timestamp).toISOString()
      },
      {
        id: randomUUID(),
        author: "donna" as const,
        text: turn.assistantText,
        source: "browser" as const,
        createdAt: new Date(turn.timestamp + 1).toISOString()
      }
    ]);
    return { [projectIdFromRuntime(runtimeDirectory)]: messages };
  } catch {
    return {};
  }
}

function projectIdFromRuntime(runtimeDirectory: string): string {
  try {
    const configPath = path.join(runtimeDirectory, "..", "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8")) as { project?: { id?: unknown } };
    if (typeof config.project?.id === "string") return config.project.id;
  } catch {
    // A missing project config simply disables legacy history import.
  }
  return "project";
}
