import type { ProjectConfig, RoleName, Ticket } from "../domain/types.js";
import { IntegrationService } from "../git/integration-service.js";
import { projectRuntimePath } from "../platform/paths.js";
import { CommandRunner } from "../process/command-runner.js";
import { CodexService } from "../runners/codex-service.js";
import { TmuxService } from "../runners/tmux-service.js";
import { WorktreeService } from "../runners/worktree-service.js";
import { JsonProjectRuntime, type ProjectRuntimeRepository, type TicketDeliveryState } from "../runtime/project-runtime.js";
import { Redactor } from "../security/redactor.js";
import type { EventBus, ProjectEvent } from "../server/event-bus.js";
import type { ProjectRegistry } from "../server/project-registry.js";
import { CodexStageExecutor } from "./codex-stage-executor.js";
import { RunnerPool, type RunnerRecord } from "./runner-pool.js";
import { Scheduler, type StageExecution, type StageExecutionResult, type StageExecutor } from "./scheduler.js";
import { readableBlockerReason } from "./blockers.js";

type ProjectAutomation = {
  runtime: ProjectRuntimeRepository;
  pools: Map<RoleName, RunnerPool>;
  scheduler: Scheduler;
  unsubscribe: () => void;
  heartbeat: ReturnType<typeof setInterval>;
};

export type AgentTerminalSnapshot = {
  id: string;
  role: "donna" | RoleName;
  status: "working" | "idle" | "unhealthy";
  ticketId?: string;
  command: string;
  pid: number;
  output: string;
  attachCommand: string;
};

export class AutomationManager {
  readonly registry: ProjectRegistry;
  readonly events: EventBus;
  readonly commands: CommandRunner;
  readonly worktrees: WorktreeService;
  readonly tmux: TmuxService;
  readonly codex: CodexService;
  readonly integration: IntegrationService;
  #projects = new Map<string, ProjectAutomation>();
  #merges = new Map<string, Promise<TicketDeliveryState>>();

  constructor(registry: ProjectRegistry, events: EventBus, options: { codexCommand?: string } = {}) {
    this.registry = registry;
    this.events = events;
    this.commands = new CommandRunner();
    this.worktrees = new WorktreeService(this.commands);
    this.tmux = new TmuxService(this.commands);
    this.codex = new CodexService(this.tmux, new Redactor([]), options.codexCommand ?? "codex");
    this.integration = new IntegrationService(this.commands, this.worktrees);
  }

  register(projectId: string): void {
    if (this.#projects.has(projectId)) return;
    const config = this.registry.get(projectId);
    const runtime = new JsonProjectRuntime(projectRuntimePath(config.project.repositoryRoot));
    const pools = new Map<RoleName, RunnerPool>();
    for (const role of ["developer", "reviewer", "qa"] as const) {
      pools.set(role, new RunnerPool(role, config.pools[role].max, async (createdRole, slot) => {
        const worktree = await this.worktrees.ensureRunner(config, createdRole, slot);
        const consolePane = await this.tmux.ensurePane({
          session: sessionName(projectId),
          window: worktree.id,
          cwd: worktree.worktreePath
        });
        await this.tmux.ensureInteractiveCodex(consolePane, {
          command: this.codex.codexCommand,
          worktreePath: worktree.worktreePath,
          model: config.pools[createdRole].model ?? "gpt-5.6-sol",
          reasoningEffort: config.pools[createdRole].reasoningEffort ?? "medium",
          fullAccess: config.automation.fullAccess,
          env: { CODEX_RUNNERS_PROJECT_ROOT: config.project.repositoryRoot }
        });
        const automationPane = await this.tmux.ensurePane({
          session: sessionName(projectId),
          window: `${worktree.id}-automation`,
          cwd: worktree.worktreePath
        });
        const runner: RunnerRecord = {
          ...worktree,
          status: "idle",
          tmuxTarget: automationPane.target,
          consoleTmuxTarget: consolePane.target
        };
        const threadId = runtime.getRunnerThread(projectId, runner.id);
        if (threadId) runner.threadId = threadId;
        return runner;
      }));
    }
    const codexExecutor = new CodexStageExecutor(
      this.codex,
      this.integration,
      (input, event) => this.events.publish({
        type: "runner.event",
        projectId,
        revision: this.registry.getBoard(projectId).revision,
        payload: { runnerId: input.runner.id, ticketId: input.ticket.id, event }
      }),
      runtime
    );
    const executor = new PreparedStageExecutor(this.worktrees, codexExecutor);
    const scheduler = new Scheduler({ registry: this.registry, events: this.events, runtime, pools, executor });
    const unsubscribe = this.events.subscribe(projectId, event => this.#handleEvent(projectId, event));
    const heartbeat = setInterval(() => this.reconcile(projectId), 2_000);
    heartbeat.unref();
    this.#projects.set(projectId, { runtime, pools, scheduler, unsubscribe, heartbeat });
    for (const ticket of config.board.tickets.filter(candidate => candidate.status === "done")) {
      const state = runtime.getTicket(projectId, ticket.id);
      if (state.mergeState !== "merging") continue;
      state.mergeState = "failed";
      state.mergeError = "The previous merge was interrupted. Retry when ready.";
      runtime.setTicket(projectId, ticket.id, state);
    }
    void this.#hydrateInteractiveWindows(projectId, config);
    for (const ticket of config.board.tickets.filter(candidate => candidate.status === "blocked")) {
      this.#notifyBlocker(projectId, ticket);
    }
    this.reconcile(projectId);
  }

  reconcile(projectId: string): void {
    const automation = this.#projects.get(projectId);
    if (!automation) return;
    void automation.scheduler.schedule(projectId).catch(error => {
      if (!this.#projects.has(projectId)) return;
      this.events.publish({
        type: "automation.error",
        projectId,
        revision: this.registry.getBoard(projectId).revision,
        payload: { message: error instanceof Error ? error.message : String(error) }
      });
    });
  }

  list(projectId: string): RunnerRecord[] {
    const automation = this.#projects.get(projectId);
    if (!automation) return [];
    return [...automation.pools.values()].flatMap(pool => pool.list());
  }

  get(projectId: string, runnerId: string): RunnerRecord | undefined {
    return this.list(projectId).find(runner => runner.id === runnerId);
  }

  deliveries(projectId: string): Record<string, TicketDeliveryState> {
    const config = this.registry.get(projectId);
    const runtime = this.runtimeFor(config);
    return Object.fromEntries(config.board.tickets.map(ticket => {
      const state = runtime.getTicket(projectId, ticket.id);
      const mergeState = state.mergeState ?? (state.integrationCommit ? "merged" : undefined);
      return [ticket.id, {
        ...(state.deliveryBranch ? { deliveryBranch: state.deliveryBranch } : {}),
        ...(state.integrationCommit ? { integrationCommit: state.integrationCommit } : {}),
        ...(mergeState ? { mergeState } : {}),
        ...(state.mergeError ? { mergeError: state.mergeError } : {})
      }];
    }));
  }

  mergeTicket(projectId: string, ticketId: string): Promise<TicketDeliveryState> {
    const key = `${projectId}:${ticketId}`;
    const active = this.#merges.get(key);
    if (active) return active;
    const merge = this.#mergeTicket(projectId, ticketId).finally(() => this.#merges.delete(key));
    this.#merges.set(key, merge);
    return merge;
  }

  async abortTicket(projectId: string, ticketId: string, expectedRevision: number): Promise<{ revision: number; ticket: Ticket }> {
    const automation = this.#projects.get(projectId);
    if (!automation) throw new Error(`Automation runtime for ${projectId} is unavailable`);
    const ticket = this.registry.getBoard(projectId).tickets.find(candidate => candidate.id === ticketId);
    if (!ticket) throw new Error(`Ticket ${ticketId} was not found`);
    if (!["todo", "in_progress", "review", "qa"].includes(ticket.status)) {
      throw new Error(`${ticket.title} is not running and cannot be aborted`);
    }
    const result = await this.registry.updateTicket(projectId, ticketId, {
      status: "blocked",
      assignedRunnerId: null,
      blocker: { kind: "human_input", reason: "Aborted by the user. Add instructions when you are ready to resume." }
    }, expectedRevision);
    const runtime = automation.runtime.getTicket(projectId, ticketId);
    runtime.findings = ["The user stopped this ticket before the current stage completed."];
    automation.runtime.setTicket(projectId, ticketId, runtime);
    for (const pool of automation.pools.values()) {
      for (const runner of pool.list().filter(candidate => candidate.ticketId === ticketId)) {
        await this.tmux.interruptPane(runner.tmuxTarget).catch(() => undefined);
        pool.release(runner.id);
        this.events.publish({
          type: "runner.updated",
          projectId,
          revision: result.revision,
          payload: { runnerId: runner.id, status: "idle" }
        });
      }
    }
    return result;
  }

  async #mergeTicket(projectId: string, ticketId: string): Promise<TicketDeliveryState> {
    const project = this.registry.get(projectId);
    const ticket = project.board.tickets.find(candidate => candidate.id === ticketId);
    if (!ticket) throw new Error(`Ticket ${ticketId} was not found`);
    const automation = this.#projects.get(projectId);
    if (!automation) throw new Error(`Automation runtime for ${projectId} is unavailable`);
    const state = automation.runtime.getTicket(projectId, ticketId);
    if (ticket.status !== "done" || !["ready", "failed"].includes(state.mergeState ?? "") || !state.deliveryBranch || !state.developerRunnerId) {
      throw new Error(`${ticket.title} is not ready to merge`);
    }
    state.mergeState = "merging";
    delete state.mergeError;
    automation.runtime.setTicket(projectId, ticketId, state);
    this.#publishDelivery(projectId, ticketId, state);
    try {
      const verification = [
        ...project.verification.typecheck,
        ...project.verification.test,
        ...project.verification.lint,
        ...project.verification.build,
        ...project.verification.ui
      ];
      const result = await this.integration.integrate(project, state.deliveryBranch, verification);
      state.integrationCommit = result.commit;
      state.mergeState = "merged";
      automation.runtime.setTicket(projectId, ticketId, state);
      await this.worktrees.removeDeliveryBranch(project, state.deliveryBranch);
      this.#publishDelivery(projectId, ticketId, state);
      return this.deliveries(projectId)[ticketId] ?? {};
    } catch (error) {
      state.mergeState = "failed";
      state.mergeError = error instanceof Error ? error.message : String(error);
      automation.runtime.setTicket(projectId, ticketId, state);
      this.#publishDelivery(projectId, ticketId, state);
      throw error;
    }
  }

  #publishDelivery(projectId: string, ticketId: string, state: TicketDeliveryState): void {
    this.events.publish({
      type: "ticket.delivery",
      projectId,
      revision: this.registry.getBoard(projectId).revision,
      payload: { ticketId, delivery: state }
    });
  }

  async terminals(projectId: string): Promise<AgentTerminalSnapshot[]> {
    this.registry.get(projectId);
    const session = sessionName(projectId);
    const windows = await this.tmux.listWindows(session).catch(() => []);
    const runners = new Map(this.list(projectId).map(runner => [runner.id, runner]));
    return Promise.all(windows.filter(id => !id.endsWith("-automation")).map(async id => {
      const target = `${session}:${id}`;
      const runner = runners.get(id);
      const [pane, output] = await Promise.all([
        this.tmux.inspectPane(target).catch(() => ({ command: "unavailable", pid: 0, cwd: "" })),
        this.tmux.capturePane(target).catch(() => "Terminal output is temporarily unavailable.")
      ]);
      return {
        id,
        role: id === "donna" ? "donna" as const : runner?.role ?? roleFromRunnerId(id),
        status: pane.pid === 0 ? "unhealthy" : runner?.status === "working" ? "working" : runner?.status === "unhealthy" ? "unhealthy" : "idle",
        ...(runner?.ticketId ? { ticketId: runner.ticketId } : {}),
        command: id === "donna" ? pane.command : "codex",
        pid: pane.pid,
        output: stripTerminalControl(output).trimEnd(),
        attachCommand: `tmux attach -t ${target}`
      };
    }));
  }

  async #hydrateInteractiveWindows(projectId: string, config: ProjectConfig): Promise<void> {
    const session = sessionName(projectId);
    const windows = await this.tmux.listWindows(session).catch(() => []);
    await Promise.all(windows.filter(id => id !== "donna" && !id.endsWith("-automation")).map(async id => {
      const role = roleFromRunnerId(id);
      const target = `${session}:${id}`;
      const state = await this.tmux.inspectPane(target).catch(() => undefined);
      if (!state?.cwd) return;
      await this.tmux.ensureInteractiveCodex({ session, window: id, target, cwd: state.cwd }, {
        command: this.codex.codexCommand,
        worktreePath: state.cwd,
        model: config.pools[role].model ?? "gpt-5.6-sol",
        reasoningEffort: config.pools[role].reasoningEffort ?? "medium",
        fullAccess: config.automation.fullAccess,
        env: { CODEX_RUNNERS_PROJECT_ROOT: config.project.repositoryRoot }
      });
    }));
  }

  runtimeFor(config: ProjectConfig): ProjectRuntimeRepository {
    this.register(config.project.id);
    const automation = this.#projects.get(config.project.id);
    if (!automation) throw new Error(`Automation runtime for ${config.project.id} is unavailable`);
    return automation.runtime;
  }

  close(): void {
    for (const project of this.#projects.values()) {
      project.unsubscribe();
      clearInterval(project.heartbeat);
    }
    this.#projects.clear();
  }

  async unregister(projectId: string): Promise<void> {
    const automation = this.#projects.get(projectId);
    if (automation) {
      automation.unsubscribe();
      clearInterval(automation.heartbeat);
    }
    this.#projects.delete(projectId);
    await this.tmux.killSession(sessionName(projectId)).catch(() => undefined);
  }

  #handleEvent(projectId: string, event: ProjectEvent): void {
    if (event.type === "project.updated") {
      const automation = this.#projects.get(projectId);
      const config = this.registry.get(projectId);
      for (const role of ["developer", "reviewer", "qa"] as const) {
        automation?.pools.get(role)?.setMaximum(config.pools[role].max);
      }
    }
    if (event.type === "ticket.updated") {
      const ticketId = typeof (event.payload.ticket as { id?: unknown } | undefined)?.id === "string"
        ? (event.payload.ticket as { id: string }).id
        : undefined;
      const ticket = ticketId
        ? this.registry.getBoard(projectId).tickets.find(candidate => candidate.id === ticketId)
        : undefined;
      if (ticket?.status === "blocked") this.#notifyBlocker(projectId, ticket);
      if (ticket?.status === "backlog") {
        const runner = this.list(projectId).find(candidate => candidate.ticketId === ticket.id);
        if (runner) void this.tmux.interruptPane(runner.tmuxTarget).catch(() => undefined);
      }
    }
    if (event.type === "ticket.created" || event.type === "ticket.updated" || event.type === "project.updated") {
      this.reconcile(projectId);
    }
  }

  #notifyBlocker(projectId: string, ticket: Ticket): void {
    const automation = this.#projects.get(projectId);
    if (!automation || automation.runtime.getBlockerNotification(projectId, ticket.id) === ticket.updatedAt) return;
    const runtime = automation.runtime.getTicket(projectId, ticket.id);
    const message = automation.runtime.appendDonnaMessage(projectId, {
      author: "donna",
      text: buildBlockerMessage(this.registry.get(projectId), ticket, runtime.findings),
      source: "mcp"
    });
    automation.runtime.setBlockerNotification(projectId, ticket.id, ticket.updatedAt);
    this.events.publish({
      type: "donna.blocker",
      projectId,
      revision: this.registry.getBoard(projectId).revision,
      payload: { message, ticketId: ticket.id }
    });
  }
}

class PreparedStageExecutor implements StageExecutor {
  readonly worktrees: WorktreeService;
  readonly delegate: CodexStageExecutor;

  constructor(worktrees: WorktreeService, delegate: CodexStageExecutor) {
    this.worktrees = worktrees;
    this.delegate = delegate;
  }

  async execute(input: StageExecution): Promise<StageExecutionResult> {
    const target = input.runner.role === "developer"
      ? input.runtime.deliveryBranch ?? await this.worktrees.integrationRef(input.project, false)
      : input.runtime.deliveryBranch
        ?? (input.runtime.developerRunnerId
          ? `${input.project.worktrees.branchPrefix}/${input.runtime.developerRunnerId}`
          : await this.worktrees.integrationRef(input.project, false));
    await this.worktrees.synchronize(
      input.project,
      input.runner.worktreePath,
      target,
      "exact",
      assignedRunnerId(input) === input.runner.id
    );
    return this.delegate.execute(input);
  }

  integrate(input: StageExecution): Promise<{ commit: string }> {
    return this.delegate.integrate(input);
  }

  async seal(input: StageExecution): Promise<{ branch: string }> {
    const sourceBranch = input.runtime.developerRunnerId
      ? `${input.project.worktrees.branchPrefix}/${input.runtime.developerRunnerId}`
      : input.runner.branch;
    return { branch: await this.worktrees.sealDelivery(input.project, sourceBranch, input.ticket.id) };
  }
}

function assignedRunnerId(input: StageExecution): string | undefined {
  if (input.runner.role === "developer") return input.runtime.developerRunnerId;
  if (input.runner.role === "reviewer") return input.runtime.reviewerRunnerId;
  return input.runtime.qaRunnerId;
}

function sessionName(projectId: string): string {
  return `codex-runners-${projectId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function roleFromRunnerId(id: string): RoleName {
  if (id.startsWith("reviewer-")) return "reviewer";
  if (id.startsWith("qa-")) return "qa";
  return "developer";
}

function stripTerminalControl(value: string): string {
  return value
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, "")
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "");
}

function buildBlockerMessage(project: ProjectConfig, ticket: Ticket, findings: string[]): string {
  const unfinishedDependencies = ticket.dependencies
    .map(id => project.board.tickets.find(candidate => candidate.id === id))
    .filter(dependency => dependency?.status !== "done");
  const reason = readableBlockerReason(
    ticket.blocker?.reason
      ?? findings.find(finding => finding.trim())
      ?? ticket.comments.at(-1)?.body,
    "No technical blocker was recorded by the runner."
  );
  if (ticket.blocker?.kind === "dependency" || unfinishedDependencies.length > 0) {
    const names = unfinishedDependencies.map(dependency => `**${dependency?.title ?? "Unknown ticket"}**`).join(", ");
    return `**${ticket.title}** is waiting for ${names}. It will resume automatically when ${unfinishedDependencies.length === 1 ? "that ticket is" : "those tickets are"} done.`;
  }
  const question = ticket.blocker?.question ?? `The runner stopped because “${reason}”. Should it retry with the current implementation?`;
  const recommendation = ticket.blocker?.recommendedAction ?? "Retry the current stage using the safest non-destructive approach, then continue.";
  const deadline = ticket.blocker?.autoResumeAt
    ? `\n\nIf you do not respond by ${new Date(ticket.blocker.autoResumeAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}, I’ll apply that recommendation automatically.`
    : "";
  return `**${ticket.title}** needs your input: ${question}\n\n**Recommended:** ${recommendation}${deadline}\n\nDouble-click the ticket to answer now.`;
}
