import { randomUUID } from "node:crypto";
import type { ProjectConfig, RoleName, Ticket, TicketStatus } from "../domain/types.js";
import type { TicketRuntimeState, ProjectRuntimeRepository } from "../runtime/project-runtime.js";
import type { EventBus } from "../server/event-bus.js";
import type { ProjectRegistry } from "../server/project-registry.js";
import { humanBlockerPrompt, readableBlockerReason } from "./blockers.js";
import { nextStage } from "./state-machine.js";
import type { RunnerPool, RunnerRecord } from "./runner-pool.js";

export type StageExecution = {
  project: ProjectConfig;
  ticket: Ticket;
  runner: RunnerRecord;
  runtime: TicketRuntimeState;
};

export type StageExecutionResult = {
  kind: "passed" | "failed" | "blocked";
  summary: string;
  findings: string[];
  decision?: {
    question: string;
    recommendedAction: string;
    timeoutMinutes?: number;
  };
};

export interface StageExecutor {
  execute(input: StageExecution): Promise<StageExecutionResult>;
  integrate(input: StageExecution): Promise<{ commit: string }>;
  seal?(input: StageExecution): Promise<{ branch: string }>;
}

export type SchedulerDependencies = {
  registry: ProjectRegistry;
  events: EventBus;
  runtime: ProjectRuntimeRepository;
  pools: Map<RoleName, RunnerPool>;
  executor: StageExecutor;
};

export class Scheduler {
  readonly dependencies: SchedulerDependencies;
  #locks = new Map<string, Promise<void>>();
  #mutationLocks = new Map<string, Promise<void>>();
  #executions = new Map<string, Promise<void>>();

  constructor(dependencies: SchedulerDependencies) {
    this.dependencies = dependencies;
  }

  async reconcile(projectId: string): Promise<void> {
    await this.#schedule(projectId);
    await this.#drain(projectId);
  }

  schedule(projectId: string): Promise<void> {
    return this.#schedule(projectId);
  }

  #schedule(projectId: string): Promise<void> {
    const previous = this.#locks.get(projectId) ?? Promise.resolve();
    const run = previous.then(() => this.#reconcile(projectId));
    this.#locks.set(projectId, run.catch(() => undefined));
    return run;
  }

  async #drain(projectId: string): Promise<void> {
    while (true) {
      await this.#schedule(projectId);
      const active = [...this.#executions.entries()]
        .filter(([key]) => key.startsWith(`${projectId}:`))
        .map(([, execution]) => execution);
      if (active.length === 0) return;
      await Promise.all(active);
    }
  }

  async #reconcile(projectId: string): Promise<void> {
    for (let cycle = 0; cycle < 1_000; cycle += 1) {
      const project = this.dependencies.registry.get(projectId);
      if (!project.automation.enabled) return;
      if (await this.#reconcileBlockers(projectId, project)) continue;
      const candidates = eligibleTickets(project, this.dependencies.runtime);
      const assignments: Array<{ ticket: Ticket; runner: RunnerRecord; pool: RunnerPool }> = [];

      for (const ticket of candidates) {
        if (this.#executions.has(executionKey(projectId, ticket.id))) continue;
        const role = roleForStatus(ticket.status);
        if (!role) continue;
        const pool = this.dependencies.pools.get(role);
        if (!pool) continue;
        const runtime = this.dependencies.runtime.getTicket(projectId, ticket.id);
        const preferred = preferredRunner(ticket, role, runtime);
        const runner = await pool.claim(preferred);
        if (!runner) continue;
        runner.ticketId = ticket.id;
        assignments.push({ ticket, runner, pool });
      }

      if (assignments.length === 0) return;
      const prepared: Array<{ ticket: Ticket; runner: RunnerRecord; pool: RunnerPool }> = [];
      for (const assignment of assignments) {
        let ticket = assignment.ticket;
        if (ticket.status === "todo") {
          const currentBoard = this.dependencies.registry.getBoard(projectId);
          const moved = await this.dependencies.registry.updateTicket(
            projectId,
            ticket.id,
            { status: "in_progress" },
            currentBoard.revision
          );
          ticket = moved.ticket;
        }
        prepared.push({ ...assignment, ticket });
        this.dependencies.events.publish({
          type: "runner.updated",
          projectId,
          revision: this.dependencies.registry.getBoard(projectId).revision,
          payload: { runnerId: assignment.runner.id, status: "working", ticketId: ticket.id }
        });
      }

      for (const assignment of prepared) {
        const key = executionKey(projectId, assignment.ticket.id);
        const execution = this.#runAssignment(projectId, assignment.ticket, assignment.runner, assignment.pool, key);
        this.#executions.set(key, execution);
      }
      return;
    }
    throw new Error(`Scheduler exceeded 1000 reconciliation cycles for ${projectId}`);
  }

  async #runAssignment(projectId: string, assignedTicket: Ticket, runner: RunnerRecord, pool: RunnerPool, key: string): Promise<void> {
    let ticket = assignedTicket;
    try {
      while (true) {
        const previousStatus = ticket.status;
        const nextStatus = await this.#execute(projectId, ticket, runner);
        if (!nextStatus || nextStatus !== previousStatus || nextStatus === "blocked") break;
        const nextTicket = this.dependencies.registry.getBoard(projectId).tickets.find(candidate => candidate.id === ticket.id);
        if (!nextTicket) break;
        ticket = nextTicket;
      }
    } catch (error) {
      try {
        await this.#blockExecutionError(projectId, ticket, runner, error);
      } catch (blockerError) {
        this.dependencies.events.publish({
          type: "automation.error",
          projectId,
          revision: this.dependencies.registry.getBoard(projectId).revision,
          payload: {
            runnerId: runner.id,
            ticketId: ticket.id,
            message: blockerError instanceof Error ? blockerError.message : String(blockerError)
          }
        });
      }
    } finally {
      pool.release(runner.id);
      this.#executions.delete(key);
      this.dependencies.events.publish({
        type: "runner.updated",
        projectId,
        revision: this.dependencies.registry.getBoard(projectId).revision,
        payload: { runnerId: runner.id, status: "idle" }
      });
      void this.#schedule(projectId).catch(() => undefined);
    }
  }

  async #execute(projectId: string, queuedTicket: Ticket, runner: RunnerRecord): Promise<TicketStatus | null> {
    const currentProject = this.dependencies.registry.get(projectId);
    const ticket = currentProject.board.tickets.find(candidate => candidate.id === queuedTicket.id);
    if (!ticket || !currentProject.automation.actionableStatuses.includes(ticket.status)) return null;
    const runtime = this.dependencies.runtime.getTicket(projectId, ticket.id);
    if (runner.role === "developer" && !runtime.developerRunnerId) runtime.developerRunnerId = runner.id;
    if (runner.role === "reviewer") runtime.reviewerRunnerId = runner.id;
    if (runner.role === "qa") runtime.qaRunnerId = runner.id;
    this.dependencies.runtime.setTicket(projectId, ticket.id, runtime);
    const execution: StageExecution = { project: currentProject, ticket, runner, runtime };
    const result = await this.dependencies.executor.execute(execution);
    const latestTicket = this.dependencies.registry.getBoard(projectId).tickets.find(candidate => candidate.id === ticket.id);
    if (!latestTicket || !currentProject.automation.actionableStatuses.includes(latestTicket.status)) return null;
    let status: TicketStatus;

    if (result.kind === "passed" && ticket.status === "qa") {
      if (!runtime.deliveryBranch) {
        runtime.deliveryBranch = this.dependencies.executor.seal
          ? (await this.dependencies.executor.seal(execution)).branch
          : `${currentProject.worktrees.branchPrefix}/${runtime.developerRunnerId ?? runner.id}`;
      }
      runtime.mergeState = "ready";
      delete runtime.mergeError;
      status = "done";
    } else {
      if (result.kind === "failed") runtime.attempts += 1;
      runtime.findings = result.findings;
      status = nextStage(ticket.status, {
        kind: result.kind,
        attempts: runtime.attempts,
        maxRetries: currentProject.automation.maxRetries
      });
    }
    if (result.kind === "passed" && ticket.status === "in_progress") {
      runtime.deliveryBranch = this.dependencies.executor.seal
        ? (await this.dependencies.executor.seal(execution)).branch
        : runner.branch;
    }
    this.dependencies.runtime.setTicket(projectId, ticket.id, runtime);
    const blocker = status === "blocked" ? blockerForResult(currentProject, ticket, result) : null;
    await this.#updateTicket(projectId, ticket.id, { status, blocker });
    return status;
  }

  async #blockExecutionError(projectId: string, ticket: Ticket, runner: RunnerRecord, error: unknown): Promise<void> {
    const reason = readableBlockerReason(error instanceof Error ? error.message : String(error), "Runner preparation failed.");
    const runtime = this.dependencies.runtime.getTicket(projectId, ticket.id);
    runtime.findings = [reason];
    this.dependencies.runtime.setTicket(projectId, ticket.id, runtime);
    await this.#updateTicket(projectId, ticket.id, {
      status: "blocked",
      blocker: { kind: "human_input", reason }
    });
    this.dependencies.events.publish({
      type: "automation.error",
      projectId,
      revision: this.dependencies.registry.getBoard(projectId).revision,
      payload: { runnerId: runner.id, ticketId: ticket.id, message: reason }
    });
  }

  async #reconcileBlockers(projectId: string, project: ProjectConfig): Promise<boolean> {
    const done = completedTicketIds(project, this.dependencies.runtime);
    for (const ticket of project.board.tickets) {
      const unfinished = ticket.dependencies.filter(dependency => !done.has(dependency));
      if (project.automation.actionableStatuses.includes(ticket.status) && unfinished.length > 0) {
        const names = unfinished.map(id => project.board.tickets.find(candidate => candidate.id === id)?.title ?? id);
        await this.#updateTicket(projectId, ticket.id, {
          status: "blocked",
          blocker: { kind: "dependency", reason: `Waiting for ${names.join(", ")}` }
        });
        return true;
      }
      if (ticket.status !== "blocked") continue;
      if (unfinished.length > 0 && ticket.blocker?.kind !== "dependency") {
        const names = unfinished.map(id => project.board.tickets.find(candidate => candidate.id === id)?.title ?? id);
        await this.#updateTicket(projectId, ticket.id, {
          blocker: { kind: "dependency", reason: `Waiting for ${names.join(", ")}` }
        });
        return true;
      }
      if (unfinished.length === 0 && ticket.blocker?.kind === "dependency") {
        await this.#updateTicket(projectId, ticket.id, { status: "todo", blocker: null });
        return true;
      }
      if (!ticket.blocker) {
        const runtime = this.dependencies.runtime.getTicket(projectId, ticket.id);
        await this.#updateTicket(projectId, ticket.id, {
          blocker: {
            kind: "human_input",
            reason: readableBlockerReason(runtime.findings.find(finding => finding.trim()))
          }
        });
        return true;
      }
      if (ticket.blocker.kind === "human_input") {
        if (ticket.blocker.autoResumeAt && Date.parse(ticket.blocker.autoResumeAt) <= Date.now()) {
          const recommendation = ticket.blocker.recommendedAction ?? "Retry the current stage using the safest available approach.";
          const runtime = this.dependencies.runtime.getTicket(projectId, ticket.id);
          runtime.attempts = 0;
          runtime.findings = [...runtime.findings, `Automatic recommendation approved: ${recommendation}`];
          this.dependencies.runtime.setTicket(projectId, ticket.id, runtime);
          await this.#updateTicket(projectId, ticket.id, {
            status: "todo",
            blocker: null,
            comments: [...ticket.comments, {
              id: `auto-decision-${randomUUID()}`,
              author: "Automatic recommendation",
              body: recommendation,
              createdAt: new Date().toISOString()
            }]
          });
          return true;
        }
        const reason = readableBlockerReason(ticket.blocker.reason);
        const isManualAbort = /^Aborted by the user\b/i.test(reason);
        const prompt = humanBlockerPrompt(ticket.title, reason);
        if (reason !== ticket.blocker.reason || (!isManualAbort && (!ticket.blocker.question || !ticket.blocker.recommendedAction || !ticket.blocker.autoResumeAt))) {
          await this.#updateTicket(projectId, ticket.id, {
            blocker: {
              ...ticket.blocker,
              reason,
              ...(!isManualAbort && !ticket.blocker.question ? { question: prompt.question } : {}),
              ...(!isManualAbort && !ticket.blocker.recommendedAction ? { recommendedAction: prompt.example } : {}),
              ...(!isManualAbort && !ticket.blocker.autoResumeAt ? {
                autoResumeAt: new Date(Date.now() + project.automation.humanInputTimeoutMinutes * 60_000).toISOString()
              } : {})
            }
          });
          return true;
        }
      }
    }
    return false;
  }

  async #updateTicket(projectId: string, ticketId: string, patch: Partial<Ticket>): Promise<void> {
    const previous = this.#mutationLocks.get(projectId) ?? Promise.resolve();
    const mutation = previous.then(async () => {
      const board = this.dependencies.registry.getBoard(projectId);
      await this.dependencies.registry.updateTicket(projectId, ticketId, patch, board.revision);
    });
    this.#mutationLocks.set(projectId, mutation.catch(() => undefined));
    await mutation;
  }
}

function blockerForResult(project: ProjectConfig, ticket: Ticket, result: StageExecutionResult): NonNullable<Ticket["blocker"]> {
  const done = new Set(project.board.tickets.filter(candidate => candidate.status === "done").map(candidate => candidate.id));
  const unfinished = ticket.dependencies.filter(dependency => !done.has(dependency));
  if (unfinished.length > 0) {
    const names = unfinished.map(id => project.board.tickets.find(candidate => candidate.id === id)?.title ?? id);
    return { kind: "dependency", reason: `Waiting for ${names.join(", ")}` };
  }
  const reason = readableBlockerReason(result.findings.find(finding => finding.trim()) ?? result.summary);
  const fallback = humanBlockerPrompt(ticket.title, reason);
  const timeoutMinutes = Math.min(
    Math.max(result.decision?.timeoutMinutes ?? project.automation.humanInputTimeoutMinutes, 1),
    1440
  );
  return {
    kind: "human_input",
    reason,
    question: result.decision?.question ?? fallback.question,
    recommendedAction: result.decision?.recommendedAction ?? fallback.example,
    autoResumeAt: new Date(Date.now() + timeoutMinutes * 60_000).toISOString()
  };
}

function eligibleTickets(project: ProjectConfig, runtime: ProjectRuntimeRepository): Ticket[] {
  const completed = completedTicketIds(project, runtime);
  return project.board.tickets.filter(ticket => (
    project.automation.actionableStatuses.includes(ticket.status) &&
    ticket.dependencies.every(dependency => completed.has(dependency))
  ));
}

function completedTicketIds(project: ProjectConfig, runtime: ProjectRuntimeRepository): Set<string> {
  return new Set(project.board.tickets.filter(ticket => {
    if (ticket.status !== "done") return false;
    const mergeState = runtime.getTicket(project.project.id, ticket.id).mergeState;
    return mergeState !== "ready" && mergeState !== "merging" && mergeState !== "failed";
  }).map(ticket => ticket.id));
}

function roleForStatus(status: TicketStatus): RoleName | null {
  if (status === "todo" || status === "in_progress") return "developer";
  if (status === "review") return "reviewer";
  if (status === "qa") return "qa";
  return null;
}

function preferredRunner(ticket: Ticket, role: RoleName, runtime: TicketRuntimeState): string | undefined {
  if (role === "developer") return runtime.developerRunnerId ?? ticket.assignedRunnerId ?? undefined;
  if (role === "reviewer") return runtime.reviewerRunnerId;
  return runtime.qaRunnerId;
}

function executionKey(projectId: string, ticketId: string): string {
  return `${projectId}:${ticketId}`;
}
