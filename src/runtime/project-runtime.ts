import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export type TicketRuntimeState = {
  attempts: number;
  findings: string[];
  developerRunnerId?: string;
  reviewerRunnerId?: string;
  qaRunnerId?: string;
  integrationCommit?: string;
};

export interface ProjectRuntimeRepository {
  getTicket(projectId: string, ticketId: string): TicketRuntimeState;
  setTicket(projectId: string, ticketId: string, state: TicketRuntimeState): void;
}

export class MemoryProjectRuntime implements ProjectRuntimeRepository {
  #tickets = new Map<string, TicketRuntimeState>();

  getTicket(projectId: string, ticketId: string): TicketRuntimeState {
    return this.#tickets.get(key(projectId, ticketId)) ?? { attempts: 0, findings: [] };
  }

  setTicket(projectId: string, ticketId: string, state: TicketRuntimeState): void {
    this.#tickets.set(key(projectId, ticketId), structuredClone(state));
  }
}

type RuntimeDocument = {
  version: 1;
  tickets: Record<string, TicketRuntimeState>;
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
    mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(this.#document, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, this.filePath);
  }

  #load(): RuntimeDocument {
    if (!existsSync(this.filePath)) return { version: 1, tickets: {} };
    const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<RuntimeDocument>;
    if (parsed.version !== 1 || !parsed.tickets || typeof parsed.tickets !== "object") {
      throw new Error(`Invalid Codex Runners runtime document at ${this.filePath}`);
    }
    return { version: 1, tickets: parsed.tickets };
  }
}

function key(projectId: string, ticketId: string): string {
  return `${projectId}:${ticketId}`;
}
