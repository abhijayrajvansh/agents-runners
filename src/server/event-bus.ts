import { randomUUID } from "node:crypto";

export type ProjectEventInput = {
  type: string;
  projectId: string;
  revision: number;
  payload: Record<string, unknown>;
};

export type ProjectEvent = ProjectEventInput & {
  id: string;
  sequence: number;
  timestamp: string;
};

export class EventBus {
  readonly historyLimit: number;
  #history = new Map<string, ProjectEvent[]>();
  #listeners = new Map<string, Set<(event: ProjectEvent) => void>>();
  #sequences = new Map<string, number>();

  constructor(historyLimit = 200) {
    this.historyLimit = historyLimit;
  }

  publish(input: ProjectEventInput): ProjectEvent {
    const sequence = (this.#sequences.get(input.projectId) ?? 0) + 1;
    this.#sequences.set(input.projectId, sequence);
    const event: ProjectEvent = {
      ...input,
      id: randomUUID(),
      sequence,
      timestamp: new Date().toISOString()
    };
    const history = [...(this.#history.get(input.projectId) ?? []), event].slice(-this.historyLimit);
    this.#history.set(input.projectId, history);
    for (const listener of this.#listeners.get(input.projectId) ?? []) listener(event);
    return event;
  }

  subscribe(projectId: string, listener: (event: ProjectEvent) => void): () => void {
    const listeners = this.#listeners.get(projectId) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(projectId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#listeners.delete(projectId);
    };
  }

  replay(projectId: string, since: number): ProjectEvent[] {
    return (this.#history.get(projectId) ?? []).filter(event => event.sequence > since);
  }
}
