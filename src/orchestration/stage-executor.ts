import path from "node:path";

import type { IntegrationService } from "../git/integration-service.js";
import { projectRuntimePath } from "../platform/paths.js";
import { resolveRoleAgent } from "../domain/agent-selection.js";
import type { AgentEvent, AgentService, AgentTurnInput } from "../runners/agent-service.js";
import type { TmuxPane } from "../runners/tmux-service.js";
import type { ProjectRuntimeRepository } from "../runtime/project-runtime.js";
import { buildStagePrompt } from "./ticket-prompts.js";
import type { StageExecution, StageExecutionResult, StageExecutor } from "./scheduler.js";

type AgentTurnRunner = Pick<AgentService, "runTurn" | "providerFor">;
type BranchIntegrator = Pick<IntegrationService, "integrate">;

export class AgentStageExecutor implements StageExecutor {
  readonly agents: AgentTurnRunner;
  readonly integration: BranchIntegrator;
  readonly onEvent: ((input: StageExecution, event: AgentEvent) => void) | undefined;
  readonly runtime: ProjectRuntimeRepository | undefined;

  constructor(
    agents: AgentTurnRunner,
    integration: BranchIntegrator,
    onEvent?: (input: StageExecution, event: AgentEvent) => void,
    runtime?: ProjectRuntimeRepository
  ) {
    this.agents = agents;
    this.integration = integration;
    this.onEvent = onEvent;
    this.runtime = runtime;
  }

  async execute(input: StageExecution): Promise<StageExecutionResult> {
    const agent = resolveRoleAgent(input.project, input.runner.role, selection => this.agents.providerFor(selection));
    const turnInput: AgentTurnInput = {
      pane: paneFor(input),
      runtimeDirectory: path.join(
        projectRuntimePath(input.project.project.repositoryRoot),
        "runners",
        input.runner.id
      ),
      worktreePath: input.runner.worktreePath,
      prompt: buildStagePrompt(input.project, input.ticket, input.runner, input.runtime),
      fullAccess: input.project.automation.fullAccess,
      agent: agent.selection,
      model: agent.model,
      reasoningEffort: agent.reasoningEffort,
      env: { AGENTS_RUNNERS_PROJECT_ROOT: input.project.project.repositoryRoot }
    };
    if (input.runner.threadId) turnInput.threadId = input.runner.threadId;
    const result = await this.agents.runTurn(turnInput, event => {
      if (event.type === "thread.started") {
        input.runner.threadId = event.threadId;
        this.runtime?.setRunnerThread(input.project.project.id, input.runner.id, event.threadId);
      }
      this.onEvent?.(input, event);
    });
    if (result.threadId) {
      input.runner.threadId = result.threadId;
      this.runtime?.setRunnerThread(input.project.project.id, input.runner.id, result.threadId);
    }
    if (result.exitCode !== 0) {
      return {
        kind: "failed",
        summary: `${agent.selection.kind} runner exited with code ${result.exitCode}`,
        findings: result.message ? [result.message] : ["Inspect the persistent runner log for details."]
      };
    }
    return parseStageResult(result.message);
  }

  async integrate(input: StageExecution): Promise<{ commit: string }> {
    const verification = [
      ...input.project.verification.typecheck,
      ...input.project.verification.test,
      ...input.project.verification.lint,
      ...input.project.verification.build,
      ...input.project.verification.ui
    ];
    const candidateBranch = input.runtime.deliveryBranch
      ?? (input.runtime.developerRunnerId
        ? `${input.project.worktrees.branchPrefix}/${input.runtime.developerRunnerId}`
        : input.runner.branch);
    const result = await this.integration.integrate(input.project, candidateBranch, verification);
    return { commit: result.commit };
  }
}

export function parseStageResult(message: string): StageExecutionResult {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(message)?.[1];
  const candidates = [fenced, ...message.split(/\r?\n/).reverse(), message].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.trim()) as Record<string, unknown>;
      const outcome = normalizeOutcome(parsed.outcome);
      if (!outcome) continue;
      const summary = typeof parsed.summary === "string" ? parsed.summary : "Stage completed";
      const findings = normalizeFindings(parsed.findings);
      const decision = normalizeDecision(parsed);
      return { kind: outcome, summary, findings, ...(decision ? { decision } : {}) };
    } catch {
      // An agent may include prose before its structured final line.
    }
  }
  return {
    kind: "blocked",
    summary: "Runner did not return a valid structured result",
    findings: message ? [message] : ["No final runner message was returned."]
  };
}

function normalizeDecision(parsed: Record<string, unknown>): StageExecutionResult["decision"] | undefined {
  const nested = parsed.decision && typeof parsed.decision === "object"
    ? parsed.decision as Record<string, unknown>
    : parsed;
  const question = typeof nested.question === "string" ? nested.question.trim() : "";
  const recommendedAction = typeof nested.recommendedAction === "string"
    ? nested.recommendedAction.trim()
    : typeof nested.recommendation === "string"
      ? nested.recommendation.trim()
      : "";
  if (!question || !recommendedAction) return undefined;
  const timeout = nested.timeoutMinutes;
  return {
    question,
    recommendedAction,
    ...(typeof timeout === "number" && Number.isFinite(timeout) ? { timeoutMinutes: Math.round(timeout) } : {})
  };
}

function normalizeOutcome(value: unknown): StageExecutionResult["kind"] | null {
  if (typeof value !== "string") return null;
  const outcome = value.trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
  if (["passed", "completed", "complete", "success", "successful", "approved"].includes(outcome)) return "passed";
  if (["failed", "failure", "changes_requested", "rejected"].includes(outcome)) return "failed";
  if (outcome === "blocked") return "blocked";
  return null;
}

function normalizeFindings(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).map(([key, item]) => {
    if (Array.isArray(item)) return `${key}: ${item.map(String).join(", ")}`;
    return `${key}: ${String(item)}`;
  });
}

function paneFor(input: StageExecution): TmuxPane {
  const separator = input.runner.tmuxTarget.indexOf(":");
  const session = separator >= 0 ? input.runner.tmuxTarget.slice(0, separator) : input.runner.tmuxTarget;
  const window = separator >= 0 ? input.runner.tmuxTarget.slice(separator + 1) : input.runner.id;
  return {
    session,
    window,
    target: input.runner.tmuxTarget,
    cwd: input.runner.worktreePath
  };
}
