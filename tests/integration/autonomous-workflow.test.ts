import { afterEach, describe, expect, it } from "vitest";

import type { ProjectConfig, RoleName, Ticket } from "../../src/domain/types.js";
import { Scheduler, type StageExecution, type StageExecutor } from "../../src/orchestration/scheduler.js";
import { RunnerPool, type RunnerRecord } from "../../src/orchestration/runner-pool.js";
import { MemoryProjectRuntime } from "../../src/runtime/project-runtime.js";
import { EventBus } from "../../src/server/event-bus.js";
import { ProjectRegistry } from "../../src/server/project-registry.js";
import { createInitializedProject } from "../helpers/initialized-project.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()));
});

describe("Scheduler", () => {
  it("waits for a dependency merge before starting dependent work", async () => {
    const project = await createInitializedProject();
    cleanups.push(project.cleanup);
    const harness = await workflowHarness(project.root, new ScriptedExecutor());
    await addTicket(harness.registry, harness.config, {
      id: "foundation",
      title: "Build foundation",
      status: "todo"
    });
    await addTicket(harness.registry, harness.config, {
      id: "dependent",
      title: "Build dependent feature",
      status: "todo",
      dependencies: ["foundation"]
    });

    await harness.scheduler.reconcile(harness.config.project.id);
    expect(harness.registry.getBoard(harness.config.project.id).tickets.map(ticket => [ticket.id, ticket.status])).toEqual([
      ["foundation", "done"],
      ["dependent", "blocked"]
    ]);
    const foundation = harness.runtime.getTicket(harness.config.project.id, "foundation");
    foundation.mergeState = "merged";
    foundation.integrationCommit = "merged-foundation";
    harness.runtime.setTicket(harness.config.project.id, "foundation", foundation);
    await harness.scheduler.reconcile(harness.config.project.id);
    expect(harness.registry.getBoard(harness.config.project.id).tickets.find(ticket => ticket.id === "dependent")?.status).toBe("done");
    expect(harness.executor.calls.filter(call => call.ticketId === "dependent")[0]?.afterTicketIds)
      .toContain("foundation");
  });

  it("returns review and QA failures to the same explicitly assigned developer", async () => {
    const project = await createInitializedProject();
    cleanups.push(project.cleanup);
    const executor = new ScriptedExecutor({ reviewFailures: 1, qaFailures: 1 });
    const harness = await workflowHarness(project.root, executor);
    await addTicket(harness.registry, harness.config, {
      id: "auth",
      title: "Build auth",
      status: "todo",
      assignedRunnerId: "developer-03"
    });

    await harness.scheduler.reconcile(harness.config.project.id);
    const developerCalls = executor.calls.filter(call => call.role === "developer");

    expect(developerCalls.map(call => call.runnerId)).toEqual([
      "developer-03",
      "developer-03",
      "developer-03"
    ]);
    expect(harness.registry.getBoard(harness.config.project.id).tickets[0]?.status).toBe("done");
    expect(harness.runtime.getTicket(harness.config.project.id, "auth").attempts).toBe(2);
  });

  it("blocks a ticket after three failed review loops", async () => {
    const project = await createInitializedProject();
    cleanups.push(project.cleanup);
    const executor = new ScriptedExecutor({ reviewFailures: 3 });
    const harness = await workflowHarness(project.root, executor);
    await addTicket(harness.registry, harness.config, {
      id: "broken",
      title: "Broken feature",
      status: "todo"
    });

    await harness.scheduler.reconcile(harness.config.project.id);

    expect(harness.registry.getBoard(harness.config.project.id).tickets[0]?.status).toBe("blocked");
    expect(harness.runtime.getTicket(harness.config.project.id, "broken").attempts).toBe(3);
  });

  it("never exceeds the configured developer concurrency", async () => {
    const project = await createInitializedProject();
    cleanups.push(project.cleanup);
    const executor = new ScriptedExecutor({ delay: 20 });
    const harness = await workflowHarness(project.root, executor, { developer: 1 });
    await addTicket(harness.registry, harness.config, { id: "one", title: "One", status: "todo" });
    await addTicket(harness.registry, harness.config, { id: "two", title: "Two", status: "todo" });

    await harness.scheduler.reconcile(harness.config.project.id);

    expect(executor.maxActiveByRole.developer).toBe(1);
    expect(harness.registry.getBoard(harness.config.project.id).tickets.every(ticket => ticket.status === "done")).toBe(true);
  });
});

async function workflowHarness(root: string, executor: ScriptedExecutor, limits: Partial<Record<RoleName, number>> = {}) {
  const events = new EventBus();
  const registry = new ProjectRegistry(events);
  const config = await registry.register(root);
  const runtime = new MemoryProjectRuntime();
  const pools = new Map<RoleName, RunnerPool>(
    (["developer", "reviewer", "qa"] as const).map(role => [
      role,
      new RunnerPool(role, limits[role] ?? config.pools[role].max, async (createdRole, slot) => ({
        id: `${createdRole}-${String(slot).padStart(2, "0")}`,
        role: createdRole,
        slot,
        status: "idle",
        worktreePath: `/tmp/${createdRole}-${slot}`,
        branch: `codex-runners/${createdRole}-${String(slot).padStart(2, "0")}`,
        tmuxTarget: `${config.project.id}:${createdRole}-${slot}`
      }))
    ])
  );
  const scheduler = new Scheduler({ registry, events, runtime, pools, executor });
  return { config, registry, runtime, pools, executor, scheduler };
}

async function addTicket(
  registry: ProjectRegistry,
  config: ProjectConfig,
  ticket: Pick<Ticket, "id" | "title" | "status"> & Partial<Ticket>
) {
  const revision = registry.getBoard(config.project.id).revision;
  await registry.createTicket(config.project.id, ticket, revision);
}

class ScriptedExecutor implements StageExecutor {
  readonly calls: Array<{
    ticketId: string;
    role: RoleName;
    runnerId: string;
    afterTicketIds: string[];
  }> = [];
  readonly maxActiveByRole: Record<RoleName, number> = { developer: 0, reviewer: 0, qa: 0 };
  #activeByRole: Record<RoleName, number> = { developer: 0, reviewer: 0, qa: 0 };
  #reviewFailures: number;
  #qaFailures: number;
  #delay: number;

  constructor(options: { reviewFailures?: number; qaFailures?: number; delay?: number } = {}) {
    this.#reviewFailures = options.reviewFailures ?? 0;
    this.#qaFailures = options.qaFailures ?? 0;
    this.#delay = options.delay ?? 0;
  }

  async execute(input: StageExecution): Promise<{ kind: "passed" | "failed"; summary: string; findings: string[] }> {
    this.#activeByRole[input.runner.role] += 1;
    this.maxActiveByRole[input.runner.role] = Math.max(
      this.maxActiveByRole[input.runner.role],
      this.#activeByRole[input.runner.role]
    );
    this.calls.push({
      ticketId: input.ticket.id,
      role: input.runner.role,
      runnerId: input.runner.id,
      afterTicketIds: input.project.board.tickets.filter(ticket => ticket.status === "done").map(ticket => ticket.id)
    });
    if (this.#delay) await new Promise(resolve => setTimeout(resolve, this.#delay));
    this.#activeByRole[input.runner.role] -= 1;
    if (input.runner.role === "reviewer" && this.#reviewFailures > 0) {
      this.#reviewFailures -= 1;
      return { kind: "failed", summary: "Review failed", findings: ["Fix review issue"] };
    }
    if (input.runner.role === "qa" && this.#qaFailures > 0) {
      this.#qaFailures -= 1;
      return { kind: "failed", summary: "QA failed", findings: ["Fix QA issue"] };
    }
    return { kind: "passed", summary: "Stage passed", findings: [] };
  }

  async integrate(): Promise<{ commit: string }> {
    return { commit: "integration-commit" };
  }
}
