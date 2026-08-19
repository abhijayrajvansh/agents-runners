---
name: codex-runners
description: "Use when working in a project containing .codex-runners/config.json, operating Donna, managing the local skill-flow board, inspecting persistent runners, or coordinating skill-driven triage, review, implementation, and delivery."
---

# Codex Runners

## Overview

Treat Codex Runners as the shared operational record for the project's skill-driven work. It runs a local issue board that supports the full Matt Pocock flow bundled under `skills/`: `/grill-with-docs` for planning, `/to-spec` to record a spec, `/to-tickets` to cut tracer-bullet tickets with blocking edges, `/implement` to build one ticket, and `/code-review` before delivery. `/triage` routes inbound issues, and `/wayfinder` charts efforts too big for one session.

Keep plans, assignments, progress, and delivery state synchronized through the MCP tools; use Donna as the canonical project-manager conversation.

## Operate a project

1. Confirm `.codex-runners/config.json` exists. If the user asks to set up an uninitialized repository, run `codex-runners init` from its Git root.
2. Call `get_project`, then `get_board`. Retain the returned board revision.
3. Model work as issues. Capture planning work as `backlog` or `needs_triage`. Move an issue to `ready_for_agent` only when it is fully specified and the user or Donna intends an autonomous runner to implement it.
4. Include the latest `expectedRevision` in every write. On a revision conflict, fetch the board again, reconcile the user’s intended change, and retry once with the new revision.
5. Use `list_runners`, `get_runner`, and `get_activity` to report live progress. Use `message_donna` for prioritization, dependency, assignment, and blocker decisions.

## Issue intent

| Intent | Operation |
|---|---|
| Capture an idea | `create_ticket` in `backlog` or `needs_triage` |
| Route inbound work | run `/triage`, set category + triage state |
| Split a spec into tickets | run `/to-tickets`, record blocking edges in `dependencies` |
| Start delivery | `move_ticket` to `ready_for_agent` (`/to-tickets` publishes there) |
| Choose a developer | `assign_ticket` with `developer-NN` |
| Add decision context | `add_ticket_comment` |
| Record execution evidence | `report_progress` or `complete_stage` |
| Inspect the team | `list_runners` or `get_runner` |
| Ask the project manager | `message_donna` |

Triage statuses (`needs_triage`, `needs_info`, `ready_for_human`, `wontfix`) are inert and editable. `ready_for_agent` is actionable: the scheduler claims it with a developer and moves it through `in_progress` → `review` → `qa` → `done`. Blocked waits for intervention; Done is delivered. Work that is not yet specifiable belongs to a `/wayfinder` map and is never implemented directly.

## Preserve runner state

- Keep runner identities, worktrees, branches, tmux panes, and Codex thread IDs persistent while Idle.
- Route review or QA findings back through the issue. Let the scheduler resume the same developer.
- Let the serialized integration lane merge and push the configured integration branch. Do not merge runner branches manually while automation is active.
- Never delete or reset user worktrees. Codex Runners may synchronize only its own clean, managed runner worktrees.
- Prefer the bundled skill flow over inventing a new process: `/grill-with-docs` before a spec, `/to-tickets` before a multi-session build, `/implement` per vertical-slice ticket, `/code-review` with the originating spec, and `/wayfinder` for efforts too large for one session.

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
- Moving a `needs_triage` issue to `ready_for_agent` without an agent brief, or implementing a spec before `/to-tickets` cut it into vertical slices.
- Starting unmanaged agents instead of using the configured runner pools.
- Printing `.env` values while diagnosing a runner.
- Deleting idle worktrees or branches that are intentionally persistent.
