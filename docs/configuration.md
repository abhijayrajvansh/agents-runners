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

`board.revision` provides optimistic concurrency. Every REST or MCP write includes the latest expected revision. The default column order is:

```text
backlog → todo → in_progress → review → qa → done
                                  ↘ blocked
```

Tickets contain title, description, acceptance criteria, status, priority, type, tags, dependencies, optional runner assignment, role instructions, environment profile, and comments. Backlog and Blocked never claim new runners.

## Automation

| Field | Default | Meaning |
|---|---:|---|
| `automation.enabled` | `true` | Reconcile actionable tickets automatically |
| `automation.fullAccess` | `true` | Run worker Codex turns without sandbox or approval pauses |
| `automation.maxRetries` | `3` | Review/QA fix loops before Blocked |
| `automation.autoMerge` | `true` | Merge a QA-passed candidate through the integrator |
| `automation.autoPush` | `true` | Push the integration result |
| `automation.actionableStatuses` | Todo, In Progress, Review, QA | States that wake runners |

Set `automation.enabled` to `false` to keep the board readable without starting jobs. Changing `fullAccess` affects future turns only.

## Runner pools

`pools.developer`, `pools.reviewer`, and `pools.qa` each accept:

- `max` — concurrency cap, default `5`
- `model` — optional Codex model override
- `reasoningEffort` — optional role-specific effort
- `instructions` — persistent role guidance appended to stage prompts

Runner IDs are stable (`developer-01`, `reviewer-01`, `qa-01`). Explicit ticket assignment takes priority over automatic claiming.

## Worktrees and environments

Persistent runner worktrees default to `.worktrees/codex-runners/<runner-id>` with branches under `codex-runners/`. They are never automatically deleted.

`environments.files` lists development environment filenames copied into runner worktrees. Defaults are `.env`, `.env.local`, and `.env.development`. Values are never placed in config. Production-like filenames are ignored unless `environments.allowProduction` is explicitly set to `true`.

## Verification and Computer Use

Commands under `verification.typecheck`, `test`, `lint`, `build`, and `ui` run in the isolated integration worktree before a push. Add only non-interactive development commands.

`computerUse.enabled` and `computerUse.instructions` tell QA runners whether and how to perform human-style UI checks. Computer Use still observes confirmation requirements for sensitive or consequential actions.
