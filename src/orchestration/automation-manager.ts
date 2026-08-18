import type { ProjectConfig, RoleName, Ticket } from "../domain/types.js";
import { IntegrationService } from "../git/integration-service.js";
import { projectRuntimePath } from "../platform/paths.js";
import { CommandRunner } from "../process/command-runner.js";
import { CodexService } from "../runners/codex-service.js";
import { TmuxService } from "../runners/tmux-service.js";
import { WorktreeService } from "../runners/worktree-service.js";
import { JsonProjectRuntime, type ProjectRuntimeRepository } from "../runtime/project-runtime.js";
import { Redactor } from "../security/redactor.js";
import type { EventBus, ProjectEvent } from "../server/event-bus.js";
import type { ProjectRegistry } from "../server/project-registry.js";
import { CodexStageExecutor } from "./codex-stage-executor.js";
import { RunnerPool, type RunnerRecord } from "./runner-pool.js";
import { Scheduler, type StageExecution, type StageExecutionResult, type StageExecutor } from "./scheduler.js";

type ProjectAutomation = {
  runtime: ProjectRuntimeRepository;
  pools: Map<RoleName, RunnerPool>;
  scheduler: Scheduler;
  unsubscribe: () => void;
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
        const pane = await this.tmux.ensurePane({
          session: sessionName(projectId),
          window: worktree.id,
          cwd: worktree.worktreePath
        });
        const runner: RunnerRecord = {
          ...worktree,
          status: "idle",
          tmuxTarget: pane.target
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
    this.#projects.set(projectId, { runtime, pools, scheduler, unsubscribe });
    for (const ticket of config.board.tickets.filter(candidate => candidate.status === "blocked")) {
      this.#notifyBlocker(projectId, ticket);
    }
    this.reconcile(projectId);
  }

  reconcile(projectId: string): void {
    const automation = this.#projects.get(projectId);
    if (!automation) return;
    void automation.scheduler.reconcile(projectId).catch(error => {
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

  runtimeFor(config: ProjectConfig): ProjectRuntimeRepository {
    this.register(config.project.id);
    const automation = this.#projects.get(config.project.id);
    if (!automation) throw new Error(`Automation runtime for ${config.project.id} is unavailable`);
    return automation.runtime;
  }

  close(): void {
    for (const project of this.#projects.values()) project.unsubscribe();
    this.#projects.clear();
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
    const target = input.runner.role === "developer" || !input.runtime.developerRunnerId
      ? `${input.project.project.remote}/${input.project.project.integrationBranch}`
      : `${input.project.worktrees.branchPrefix}/${input.runtime.developerRunnerId}`;
    await this.worktrees.synchronize(
      input.project,
      input.runner.worktreePath,
      target,
      input.runner.role === "developer" ? "fast-forward" : "exact",
      assignedRunnerId(input) === input.runner.id
    );
    return this.delegate.execute(input);
  }

  integrate(input: StageExecution): Promise<{ commit: string }> {
    return this.delegate.integrate(input);
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

function buildBlockerMessage(project: ProjectConfig, ticket: Ticket, findings: string[]): string {
  const unfinishedDependencies = ticket.dependencies
    .map(id => project.board.tickets.find(candidate => candidate.id === id))
    .filter(dependency => dependency?.status !== "done");
  const missingContext = !ticket.description.trim() || ticket.acceptanceCriteria.length === 0;
  const reason = findings.find(finding => finding.trim())
    ?? ticket.comments.at(-1)?.body
    ?? "No technical blocker was recorded by the runner.";
  const recommendation = unfinishedDependencies.length > 0
    ? `Complete the dependency ${unfinishedDependencies.map(dependency => `\`${dependency?.title ?? "unknown"}\``).join(", ")} first, then move this ticket to **Todo**.`
    : missingContext
      ? "Restore the missing description and acceptance criteria, then move the ticket to **Todo** for a clean retry."
      : "Review the runner finding, apply the suggested correction, then move the ticket to **Todo** to retry with the same persistent agent context.";

  return [
    "## Blocker needs your decision",
    `**Ticket:** ${ticket.title} (\`${ticket.id}\`)`,
    `**What happened:** ${reason}`,
    "### Available paths",
    `1. **Recommended:** ${recommendation}`,
    "2. **Retry now:** Move the ticket to **Todo** immediately and let the assigned developer try again.",
    "3. **Replan:** Keep it blocked, edit the ticket details, or split the problem into a smaller recovery ticket.",
    "Reply with **1**, **2**, or **3** (and any constraints). I’ll continue from your choice immediately."
  ].join("\n\n");
}
