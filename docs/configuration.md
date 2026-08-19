# Configuration

Each initialized repository owns `.codex-runners/config.json`. The daemon is its sole writer while active and replaces it atomically. Manual edits are imported when valid; invalid edits leave the last valid in-memory board active and appear in the UI.

## Project and server

| Field | Purpose |
|---|---|
| `project.id` | Stable project identifier used by REST, WebSocket, tmux, and runtime records |
| `project.name` | Display name |
| `project.repositoryRoot` | Canonical main repository path |
| `project.integrationBranch` | Delivery branch, default `dev` |
| `project.remote` | Git remote, default `origin` |
| `server.host` | Fixed to `127.0.0.1` in version 1 |
| `server.port` | Local daemon port, default `4777` |
| `server.openBrowser` | Open or reuse the project board at SessionStart |

## Board

`board.revision` provides optimistic concurrency. Every REST or MCP write includes the latest expected revision. The default column order mixes triage and delivery:

```text
backlog / needs_triage → ready_for_agent → in_progress → review → qa → done
                                                              ↘ blocked
```

`backlog`, `needs_triage`, `needs_info`, `ready_for_human`, and `wontfix` are inert. `ready_for_agent` is actionable and is the entry point autonomous runners claim. Tickets also carry `kind` (`issue`, `spec`, `ticket`, `decision`, `map`), `source` (`manual`, `triage`, `to_spec`, `to_tickets`, `wayfinder`, `donna`), an optional triage category and triage state, plus title, description, acceptance criteria, status, priority, type, tags, dependencies, optional runner assignment, role instructions, environment profile, and comments. Planning and triage statuses never claim new runners.

## Donna

Donna uses a model independently from the delivery runner pools:

| Field | Default | Meaning |
|---|---|---|
| `donna.model` | `gpt-5.6-luna` | Fast model used for project-manager chat turns |
| `donna.reasoningEffort` | `low` | Keeps routine coordination replies responsive |

Change either value in `.codex-runners/config.json`. Existing Donna threads are resumed with the configured model, so conversation context remains intact when the model changes.

Donna's browser messages, persistent Codex thread ID, and recent conversation are stored under `.codex-runners/runtime/project-runtime.json`. `start` and `restart` reload that history and resume the same model thread in the Donna tmux window. If Codex reports that the saved thread is unavailable, Donna clears only that stale thread reference, starts a new thread, and seeds it with the persisted recent conversation.

## Automation

| Field | Default | Meaning |
|---|---:|---|
| `automation.enabled` | `true` | Reconcile actionable tickets automatically |
| `automation.fullAccess` | `true` | Run worker Codex turns without sandbox or approval pauses |
| `automation.maxRetries` | `3` | Review/QA fix loops before Blocked |
| `automation.humanInputTimeoutMinutes` | `10` | Minutes before a safe recommended blocker decision is applied automatically |
| `automation.autoMerge` | `false` | Legacy compatibility field; final merges always require the Done-card button |
| `automation.autoPush` | `true` | Push ticket delivery branches and user-approved integration results |
| `automation.actionableStatuses` | Ready for agent, Todo, In Progress, Review, QA | States that wake runners |

Set `automation.enabled` to `false` to keep the board readable without starting jobs. Changing `fullAccess` affects future turns only.

Development, review, verification, and repair loops run automatically. A verification-passed issue is sealed to its own delivery branch and moved to Done. Only the **Merge to `<integrationBranch>`** button integrates it; after a successful verified merge, Codex Runners deletes that delivery branch locally and remotely. Dependent tickets wait until the prerequisite is merged, not merely verified.

Issue details are editable in planning/triage statuses (`backlog`, `needs_triage`, `needs_info`, `ready_for_human`, `wontfix`) plus Blocked and Done. `ready_for_agent`, Todo, In Progress, Review, and QA are read-only while agents own them. Their drawer exposes an emergency **Abort process** button that interrupts and unassigns active runners, clears the explicit assignment, and moves the issue to Blocked for human instructions.

When a runner genuinely needs a decision, it must record the exact question and a safe recommended answer. The Blocked drawer shows both and the response deadline. If nobody answers before `automation.humanInputTimeoutMinutes`, the heartbeat records the recommendation as decision input, moves the issue back to `ready_for_agent`, and resumes delivery. Emergency user-aborted issues never auto-resume.

## Runner pools

`pools.developer`, `pools.reviewer`, and `pools.qa` each accept:

- `max` — concurrency cap, default `5`
- `model` — optional Codex model override
- `reasoningEffort` — optional role-specific effort
- `instructions` — persistent role guidance appended to stage prompts

Runner IDs are stable (`developer-01`, `reviewer-01`, `qa-01`). Explicit ticket assignment takes priority over automatic claiming.

When the local Codex configuration includes a `codex-router` provider, Codex Runners selects it explicitly and disables Responses WebSocket probing for runner and Donna processes. The router continues to stream over its supported HTTP Responses transport without noisy `426 Upgrade Required` fallback errors. Other Codex provider configurations are left unchanged.

## Worktrees and environments

Persistent runner worktrees default to `.worktrees/codex-runners/<runner-id>` with branches under `codex-runners/`. They are never automatically deleted.

`environments.files` lists development environment filenames copied into runner worktrees. Defaults are `.env`, `.env.local`, and `.env.development`. Values are never placed in config. Production-like filenames are ignored unless `environments.allowProduction` is explicitly set to `true`.

## Verification and Computer Use

Commands under `verification.typecheck`, `test`, `lint`, `build`, and `ui` run in the isolated integration worktree before a push. Add only non-interactive development commands.

`computerUse.enabled` and `computerUse.instructions` tell QA runners whether and how to perform human-style UI checks. Computer Use still observes confirmation requirements for sensitive or consequential actions.
