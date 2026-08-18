---
name: codex-runners
description: Use when working in a project containing .codex-runners/config.json, operating Donna, managing the local Kanban board, inspecting persistent runners, or coordinating autonomous development, review, QA, and delivery.
---

# Codex Runners

## Overview

Treat Codex Runners as the shared operational record for the project. Keep plans, assignments, progress, and delivery state synchronized through its MCP tools; use Donna as the canonical project-manager conversation.

## Operate a project

1. Confirm `.codex-runners/config.json` exists. If the user asks to set up an uninitialized repository, run `codex-runners init` from its Git root.
2. Call `get_project`, then `get_board`. Retain the returned board revision.
3. Translate planning work into Backlog tickets. Move a ticket to Todo only when the user or Donna intends autonomous execution to start.
4. Include the latest `expectedRevision` in every write. On a revision conflict, fetch the board again, reconcile the user’s intended change, and retry once with the new revision.
5. Use `list_runners`, `get_runner`, and `get_activity` to report live progress. Use `message_donna` for prioritization, dependency, assignment, and blocker decisions.

## Ticket intent

| Intent | Operation |
|---|---|
| Capture an idea | `create_ticket` in `backlog` |
| Start delivery | `move_ticket` to `todo` |
| Choose a developer | `assign_ticket` with `developer-NN` |
| Add decision context | `add_ticket_comment` |
| Record execution evidence | `report_progress` or `complete_stage` |
| Inspect the team | `list_runners` or `get_runner` |
| Ask the project manager | `message_donna` |

Backlog is inert. Todo, In Progress, Review, and QA are actionable. Blocked waits for intervention; Done is delivered.

## Preserve runner state

- Keep runner identities, worktrees, branches, tmux panes, and Codex thread IDs persistent while Idle.
- Route review or QA findings back through the ticket. Let the scheduler resume the same developer.
- Let the serialized integration lane merge and push the configured integration branch. Do not merge runner branches manually while automation is active.
- Never delete or reset user worktrees. Codex Runners may synchronize only its own clean, managed runner worktrees.

## Protect environments

Use only environment filenames and profiles recorded in config. Never read, quote, log, ticket, or commit secret values. Exclude production-like files unless `environments.allowProduction` is explicitly enabled by the user. Respect `automation.fullAccess`; do not infer broader access from the presence of credentials.

## CLI quick reference

```text
codex-runners init      Initialize the current Git project
codex-runners start     Start and register the project
codex-runners open      Open its local board
codex-runners donna     Continue the shared Donna thread
codex-runners status    Inspect daemon state
codex-runners doctor    Check Node, Git, tmux, Codex, auth, branch, and daemon
codex-runners stop      Stop processes; preserve all persistent runner state
```

## Common mistakes

- Editing `config.json` concurrently without a revision-aware MCP write.
- Moving planning-only work out of Backlog unintentionally.
- Starting unmanaged agents instead of using the configured runner pools.
- Printing `.env` values while diagnosing a runner.
- Deleting idle worktrees or branches that are intentionally persistent.
