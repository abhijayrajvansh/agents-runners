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
      "Implement or repair the ticket in this persistent worktree.",
      "Run the relevant verification, commit every completed change on this runner branch, and leave the worktree clean.",
      "Do not merge or push the integration branch."
    ],
    reviewer: [
      "Review the developer branch against the ticket and acceptance criteria.",
      "Do not edit code. Return failed with precise findings when changes are required."
    ],
    qa: [
      "Validate the implemented behavior as a user and run the configured QA checks.",
      project.computerUse.enabled ? project.computerUse.instructions : "Do not use UI automation unless the ticket requires it.",
      "Do not edit code. Return failed with reproducible findings when validation fails."
    ]
  }[runner.role];
  const humanInput = ticket.comments
    .filter(comment => comment.author === "Human input")
    .map(comment => `- ${comment.body}`)
    .join("\n");
  return [
    `You are ${runner.id}, the persistent ${runner.role} for ${project.project.name}.`,
    `Ticket ${ticket.id}: ${ticket.title}`,
    ticket.description,
    `Acceptance criteria:\n${ticket.acceptanceCriteria.map(item => `- ${item}`).join("\n") || "- Complete the described work."}`,
    runtime.findings.length ? `Findings to address:\n${runtime.findings.map(item => `- ${item}`).join("\n")}` : "",
    humanInput ? `Human input received:\n${humanInput}` : "",
    ticket.developmentInstructions,
    ticket.qaInstructions,
    project.pools[runner.role].instructions,
    ...roleInstructions,
    "Use Codex Runners MCP progress tools while working. Return a final JSON object with outcome, summary, and findings. Outcome must be exactly passed, failed, or blocked."
  ].filter(Boolean).join("\n\n");
}
