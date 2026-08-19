import type { RoleName } from "../domain/types.js";

export type RunnerStatus = "idle" | "working" | "unhealthy";

export type RunnerRecord = {
  id: string;
  role: RoleName;
  slot: number;
  status: RunnerStatus;
  worktreePath: string;
  branch: string;
  tmuxTarget: string;
  consoleTmuxTarget?: string;
  threadId?: string;
  ticketId?: string;
};

export type RunnerFactory = (role: RoleName, slot: number) => Promise<RunnerRecord>;

export class RunnerPool {
  readonly role: RoleName;
  maximum: number;
  readonly factory: RunnerFactory;
  #runners = new Map<string, RunnerRecord>();

  constructor(role: RoleName, maximum: number, factory: RunnerFactory) {
    this.role = role;
    this.maximum = maximum;
    this.factory = factory;
  }

  setMaximum(maximum: number): void {
    if (!Number.isInteger(maximum) || maximum < 0 || maximum > 20) throw new Error(`Invalid ${this.role} maximum: ${maximum}`);
    this.maximum = maximum;
  }

  async claim(preferredId?: string): Promise<RunnerRecord | null> {
    if (preferredId) {
      const slot = parsePreferredSlot(preferredId, this.role);
      if (slot === null || slot > this.maximum) return null;
      const runner = await this.#ensure(slot);
      if (runner.status !== "idle") return null;
      runner.status = "working";
      return runner;
    }

    const idle = [...this.#runners.values()]
      .filter(runner => runner.status === "idle")
      .sort((left, right) => left.slot - right.slot)[0];
    if (idle) {
      idle.status = "working";
      return idle;
    }

    for (let slot = 1; slot <= this.maximum; slot += 1) {
      const id = `${this.role}-${String(slot).padStart(2, "0")}`;
      if (this.#runners.has(id)) continue;
      const runner = await this.#ensure(slot);
      runner.status = "working";
      return runner;
    }
    return null;
  }

  release(runnerId: string): void {
    const runner = this.#runners.get(runnerId);
    if (!runner || runner.status === "unhealthy") return;
    runner.status = "idle";
    delete runner.ticketId;
  }

  markUnhealthy(runnerId: string): void {
    const runner = this.#runners.get(runnerId);
    if (runner) runner.status = "unhealthy";
  }

  get(runnerId: string): RunnerRecord | undefined {
    return this.#runners.get(runnerId);
  }

  list(): RunnerRecord[] {
    return [...this.#runners.values()].sort((left, right) => left.slot - right.slot);
  }

  async #ensure(slot: number): Promise<RunnerRecord> {
    const id = `${this.role}-${String(slot).padStart(2, "0")}`;
    const existing = this.#runners.get(id);
    if (existing) return existing;
    const created = await this.factory(this.role, slot);
    if (created.id !== id || created.role !== this.role || created.slot !== slot) {
      throw new Error(`Runner factory returned ${created.id}; expected ${id}`);
    }
    this.#runners.set(id, created);
    return created;
  }
}

function parsePreferredSlot(id: string, role: RoleName): number | null {
  const match = new RegExp(`^${role}-(\\d{2})$`).exec(id);
  if (!match?.[1]) return null;
  const slot = Number.parseInt(match[1], 10);
  return slot > 0 ? slot : null;
}
