import type { AgentProvider, AgentSelection, ReasoningEffort } from "../runners/agent-provider.js";
import type { ProjectConfig, RoleName } from "./types.js";

// Every runner turn needs the same three answers: which CLI, which model, how
// hard to think. Resolution is one place so the board, the scheduler, Donna,
// and doctor never disagree about what a project is actually running.
export type ResolvedAgent = {
  selection: AgentSelection;
  model: string;
  reasoningEffort: ReasoningEffort;
};

export function agentSelectionFor(config: ProjectConfig, override?: ProjectConfig["agent"]["kind"]): AgentSelection {
  const kind = override ?? config.agent.kind;
  // A custom binary path only applies to the project's own agent, never to an
  // overriding one, which must be found on PATH under its own name.
  return kind === config.agent.kind && config.agent.command
    ? { kind, command: config.agent.command }
    : { kind };
}

export function resolveRoleAgent(
  config: ProjectConfig,
  role: RoleName,
  provider: (selection: AgentSelection) => AgentProvider
): ResolvedAgent {
  const pool = config.pools[role];
  const selection = agentSelectionFor(config, pool.agent);
  return {
    selection,
    model: pool.model ?? provider(selection).defaultRunnerModel,
    reasoningEffort: pool.reasoningEffort ?? "medium"
  };
}

export function resolveDonnaAgent(
  config: ProjectConfig,
  provider: (selection: AgentSelection) => AgentProvider
): ResolvedAgent {
  const selection = agentSelectionFor(config, config.donna?.agent);
  return {
    selection,
    model: config.donna?.model ?? provider(selection).defaultDonnaModel,
    reasoningEffort: config.donna?.reasoningEffort ?? "low"
  };
}
