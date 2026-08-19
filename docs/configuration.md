# Configuration

Each initialized repository owns `.agents-runners/config.json`. The daemon is its sole writer while active and replaces it atomically. Manual edits are imported when valid; invalid edits leave the last valid in-memory board active and appear in the UI.

## Agent

`agent.kind` selects the coding-agent CLI that drives every runner, and `agent.command` overrides the binary path when the CLI is not on `PATH` under its usual name.

| Field | Default | Meaning |
|---|---|---|
| `agent.kind` | `codex` | `codex` or `claude`; `agents-runners init --agent claude` sets it at initialization, and re-running `init --agent <kind>` switches an existing project |
| `agent.command` | unset | Absolute path or alternate binary name for that CLI |

Donna and each pool may override the project agent with their own `agent` field, so one board can run, for example, Claude Code developers alongside Codex reviewers. Overrides always invoke that CLI by its default name; `agent.command` applies only to the project's own agent.

The two CLIs are driven identically: a headless turn per stage, streaming JSONL, resumed by a thread handle that persists across restarts. Codex turns run as `codex exec --json` and resume by thread ID; Claude Code turns run as `claude -p --output-format stream-json` and resume by session ID. Reasoning effort maps to `model_reasoning_effort` on Codex and `--effort` on Claude Code; the Codex-only `ultra` level collapses to `max` there.

Switching agents keeps the board, tickets, worktrees, and branches intact, but not conversation history: threads belong to the CLI that created them. Runners start fresh threads on their next turn.

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
| `donna.agent` | project agent | Optional agent override for Donna alone |
| `donna.model` | agent default | Fast model used for project-manager chat turns: `gpt-5.6-luna` on Codex, `sonnet` on Claude Code |
| `donna.reasoningEffort` | `low` | Keeps routine coordination replies responsive |

Change either value in `.agents-runners/config.json`. Existing Donna threads are resumed with the configured model, so conversation context remains intact when the model changes.

Donna's browser messages, persistent thread ID, and recent conversation are stored under `.agents-runners/runtime/project-runtime.json`. `start` and `restart` reload that history and resume the same model thread in the Donna tmux window. If the agent reports that the saved thread is unavailable, Donna clears only that stale thread reference, starts a new thread, and seeds it with the persisted recent conversation.

## Automation

| Field | Default | Meaning |
|---|---:|---|
| `automation.enabled` | `true` | Reconcile actionable tickets automatically |
| `automation.fullAccess` | `true` | Run worker turns without sandbox or approval pauses (`--dangerously-bypass-approvals-and-sandbox` on Codex, `--dangerously-skip-permissions` on Claude Code) |
| `automation.maxRetries` | `3` | Review/QA fix loops before Blocked |
| `automation.humanInputTimeoutMinutes` | `10` | Minutes before a safe recommended blocker decision is applied automatically |
| `automation.autoMerge` | `false` | Legacy compatibility field; final merges always require the Done-card button |
| `automation.autoPush` | `true` | Push ticket delivery branches and user-approved integration results |
| `automation.actionableStatuses` | Ready for agent, Todo, In Progress, Review, QA | States that wake runners |

Set `automation.enabled` to `false` to keep the board readable without starting jobs. Changing `fullAccess` affects future turns only.

Development, review, verification, and repair loops run automatically. A verification-passed issue is sealed to its own delivery branch and moved to Done. Only the **Merge to `<integrationBranch>`** button integrates it; after a successful verified merge, Agents Runners deletes that delivery branch locally and remotely. Dependent tickets wait until the prerequisite is merged, not merely verified.

Issue details are editable in planning/triage statuses (`backlog`, `needs_triage`, `needs_info`, `ready_for_human`, `wontfix`) plus Blocked and Done. `ready_for_agent`, Todo, In Progress, Review, and QA are read-only while agents own them. Their drawer exposes an emergency **Abort process** button that interrupts and unassigns active runners, clears the explicit assignment, and moves the issue to Blocked for human instructions.

When a runner genuinely needs a decision, it must record the exact question and a safe recommended answer. The Blocked drawer shows both and the response deadline. If nobody answers before `automation.humanInputTimeoutMinutes`, the heartbeat records the recommendation as decision input, moves the issue back to `ready_for_agent`, and resumes delivery. Emergency user-aborted issues never auto-resume.

## Runner pools

`pools.developer`, `pools.reviewer`, and `pools.qa` each accept:

- `max` — concurrency cap, default `5`
- `agent` — optional per-pool agent override (`codex` or `claude`)
- `model` — optional model override; defaults to `gpt-5.6-sol` on Codex and `opus` on Claude Code
- `reasoningEffort` — optional role-specific effort
- `instructions` — persistent role guidance appended to stage prompts

Runner IDs are stable (`developer-01`, `reviewer-01`, `qa-01`). Explicit ticket assignment takes priority over automatic claiming.

When the local Codex configuration includes a `codex-router` provider, Agents Runners selects it explicitly and disables Responses WebSocket probing for runner and Donna processes. The router continues to stream over its supported HTTP Responses transport without noisy `426 Upgrade Required` fallback errors. Other Codex provider configurations are left unchanged.

## Worktrees and environments

Persistent runner worktrees default to `.worktrees/agents-runners/<runner-id>` with branches under `agents-runners/`. They are never automatically deleted.

`environments.files` lists development environment filenames copied into runner worktrees. Defaults are `.env`, `.env.local`, and `.env.development`. Values are never placed in config. Production-like filenames are ignored unless `environments.allowProduction` is explicitly set to `true`.

## Verification and Computer Use

Commands under `verification.typecheck`, `test`, `lint`, `build`, and `ui` run in the isolated integration worktree before a push. Add only non-interactive development commands.

`computerUse.enabled` and `computerUse.instructions` tell QA runners whether and how to perform human-style UI checks. Computer Use still observes confirmation requirements for sensitive or consequential actions.
