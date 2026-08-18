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
};

export type DonnaConversationMessage = {
  id: string;
  author: "user" | "donna";
  text: string;
  source: "browser" | "terminal" | "mcp";
  createdAt: string;
};

export interface ProjectRuntimeRepository {
  getTicket(projectId: string, ticketId: string): TicketRuntimeState;
  setTicket(projectId: string, ticketId: string, state: TicketRuntimeState): void;
  getDonnaThread(projectId: string): string | undefined;
  setDonnaThread(projectId: string, threadId: string): void;
  getDonnaMessages(projectId: string): DonnaConversationMessage[];
  appendDonnaMessage(projectId: string, message: Omit<DonnaConversationMessage, "id" | "createdAt">): DonnaConversationMessage;
  getRunnerThread(projectId: string, runnerId: string): string | undefined;
  setRunnerThread(projectId: string, runnerId: string, threadId: string): void;
}

export class MemoryProjectRuntime implements ProjectRuntimeRepository {
  #tickets = new Map<string, TicketRuntimeState>();
  #donnaThreads = new Map<string, string>();
  #donnaMessages = new Map<string, DonnaConversationMessage[]>();
  #runnerThreads = new Map<string, string>();

  getTicket(projectId: string, ticketId: string): TicketRuntimeState {
    return this.#tickets.get(key(projectId, ticketId)) ?? { attempts: 0, findings: [] };
  }

  setTicket(projectId: string, ticketId: string, state: TicketRuntimeState): void {
    this.#tickets.set(key(projectId, ticketId), structuredClone(state));
  }

  getDonnaThread(projectId: string): string | undefined {
    return this.#donnaThreads.get(projectId);
  }

  setDonnaThread(projectId: string, threadId: string): void {
    this.#donnaThreads.set(projectId, threadId);
  }

  getDonnaMessages(projectId: string): DonnaConversationMessage[] {
    return structuredClone(this.#donnaMessages.get(projectId) ?? []);
  }

  appendDonnaMessage(projectId: string, message: Omit<DonnaConversationMessage, "id" | "createdAt">): DonnaConversationMessage {
    const stored = { ...message, id: randomUUID(), createdAt: new Date().toISOString() };
    this.#donnaMessages.set(projectId, [...(this.#donnaMessages.get(projectId) ?? []), stored]);
    return structuredClone(stored);
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

  getDonnaThread(projectId: string): string | undefined {
    return this.#document.donnaThreads[projectId];
  }

  setDonnaThread(projectId: string, threadId: string): void {
    this.#document.donnaThreads[projectId] = threadId;
    this.#persist();
  }

  getDonnaMessages(projectId: string): DonnaConversationMessage[] {
    return structuredClone(this.#document.donnaMessages[projectId] ?? []);
  }

  appendDonnaMessage(projectId: string, message: Omit<DonnaConversationMessage, "id" | "createdAt">): DonnaConversationMessage {
    const stored = { ...message, id: randomUUID(), createdAt: new Date().toISOString() };
    this.#document.donnaMessages[projectId] = [...(this.#document.donnaMessages[projectId] ?? []), stored].slice(-500);
    this.#persist();
    return structuredClone(stored);
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

  #load(): RuntimeDocument {
    if (!existsSync(this.filePath)) return { version: 1, tickets: {}, donnaThreads: {}, donnaMessages: {}, runnerThreads: {} };
    const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<RuntimeDocument>;
    if (parsed.version !== 1 || !parsed.tickets || typeof parsed.tickets !== "object") {
      throw new Error(`Invalid Codex Runners runtime document at ${this.filePath}`);
    }
    return {
      version: 1,
      tickets: parsed.tickets,
      donnaThreads: parsed.donnaThreads ?? {},
      donnaMessages: parsed.donnaMessages ?? loadLegacyDonnaMessages(path.dirname(this.filePath)),
      runnerThreads: parsed.runnerThreads ?? {}
    };
  }
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
