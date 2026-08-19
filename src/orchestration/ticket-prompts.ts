import type { ProjectConfig, Ticket } from "../domain/types.js";
import type { RunnerRecord } from "./runner-pool.js";
import type { TicketRuntimeState } from "../runtime/project-runtime.js";

export function buildStagePrompt(
  project: ProjectConfig,
  ticket: Ticket,
  runner: RunnerRecord,
  runtime: TicketRuntimeState
): string {
  const roleInstructions = {
    developer: [
      "Implement this vertical-slice ticket in the persistent worktree.",
      "Use the bundled /tdd and /code-review skills: write a failing test at the agreed seam, make it pass, and review the diff before committing.",
      "Run the relevant verification, commit every completed change on this runner branch, include .agents-runners/config.json if it is modified, push the runner branch, and leave the worktree clean.",
      "Do not merge or push the integration branch."
    ],
    reviewer: [
      "Review the developer branch against the originating spec and acceptance criteria using the bundled /code-review approach.",
      "Do not edit code. Return failed with precise findings when changes are required."
    ],
    qa: [
      "Validate the implemented behavior as a user and run the configured QA checks.",
      project.computerUse.enabled ? project.computerUse.instructions : "Do not use UI automation unless the ticket requires it.",
      "Do not edit code. Return failed with reproducible findings when validation fails."
    ]
  }[runner.role];
  const decisionInput = ticket.comments
    .filter(comment => comment.author === "Human input" || comment.author === "Automatic recommendation")
    .map(comment => `- ${comment.body}`)
    .join("\n");
  return [
    `You are ${runner.id}, the persistent ${runner.role} for ${project.project.name}.`,
    `Ticket ${ticket.id}: ${ticket.title}`,
    ticket.description,
    `Acceptance criteria:\n${ticket.acceptanceCriteria.map(item => `- ${item}`).join("\n") || "- Complete the described work."}`,
    runtime.findings.length ? `Findings to address:\n${runtime.findings.map(item => `- ${item}`).join("\n")}` : "",
    decisionInput ? `Decision input received:\n${decisionInput}` : "",
    ticket.developmentInstructions,
    ticket.qaInstructions,
    project.pools[runner.role].instructions,
    ...roleInstructions,
    "Use Agents Runners MCP progress tools while working. Return a final JSON object with outcome, summary, and findings. Outcome must be exactly passed, failed, or blocked.",
    "If outcome is blocked, also return decision with: question (the exact concrete question a human must answer), recommendedAction (the safest specific answer you will use automatically), and timeoutMinutes. Never ask a generic question such as what to do next. State the precise missing choice, value, or behavior. Do not recommend production secrets or destructive actions."
  ].filter(Boolean).join("\n\n");
}
