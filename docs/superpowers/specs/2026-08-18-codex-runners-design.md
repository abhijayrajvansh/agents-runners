# Agents Runners Design

Date: 2026-08-18

## Summary

Agents Runners is a macOS-first personal Codex plugin that turns project work into a local, bidirectional Kanban system operated by a persistent AI project manager named Donna. The user can talk to Donna from a browser or terminal, create and edit tickets, drag work into actionable columns, and watch persistent Codex runners implement, review, test, merge, and push work without manual orchestration.

The system is local-first. Each initialized project owns a readable `.agents-runners/config.json`; one loopback daemon coordinates all initialized projects, runner pools, `tmux` sessions, worktrees, Codex thread IDs, board events, and browser clients.

## Goals

- Open the correct local board automatically when Codex starts in an initialized project.
- Keep Donna available as the persistent project-manager thread for that project.
- Make browser chat and terminal chat use the same Donna thread.
- Support bidirectional ticket creation, editing, assignment, and drag-and-drop.
- Automatically process every actionable ticket until it reaches Done or requires human input.
- Preserve runner identities, Codex threads, `tmux` panes, worktrees, branches, and development environment files while runners are idle.
- Allow configurable role pools, initially Developer, Reviewer, and QA, with a default maximum of five runners per role.
- Use isolated worktrees for concurrent implementation and a serialized integration lane for merging into `dev`.
- Expose typed MCP tools so Donna, workers, and ordinary Codex sessions share one board.
- Stream structured Codex JSONL events and summarized progress to the white browser interface in real time.

## Non-goals for version 1

- Hosted collaboration, accounts, cloud synchronization, or multi-user permissions.
- Windows or Linux support.
- Supporting non-Codex coding-agent providers.
- Replacing Git hosting, CI, or deployment platforms.
- Deleting persistent runner worktrees or branches automatically.
- Automatically deploying merged code to production.

## Installation and project lifecycle

The plugin is stored at `~/plugins/agents-runners`, listed in the personal marketplace, and installed into Codex as `agents-runners@personal`.

The `agents-runners init` command runs inside a selected Git repository. It detects the repository root, current worktree, branches, scripts, existing worktree convention, and safe local environment filenames. It then creates:

- `.agents-runners/config.json`
- `.agents-runners/runtime/` and its persistence files
- a managed Agents Runners block in the nearest root `AGENTS.md`
- a project-local `.codex/hooks.json` SessionStart entry while preserving unrelated hooks
- persistent worktree directories lazily as runner slots are provisioned
- appropriate `.gitignore` entries for local runtime data and copied credentials

The project SessionStart hook is a no-op unless `.agents-runners/config.json` exists. For initialized projects it starts or reuses the global loopback daemon, registers the project, injects concise Donna/MCP context into the Codex session, and opens the project URL once. Resume events reuse the existing tab and daemon.

`agents-runners start`, `stop`, `status`, `open`, `donna`, and `doctor` provide explicit lifecycle control. Stopping the daemon does not remove worktrees, branches, config, tickets, logs, or Codex thread IDs.

## System architecture

### Personal plugin

The plugin manifest advertises the Agents Runners skill and MCP server. Its bundled CLI contains the daemon, project initializer, SessionStart handler, terminal Donna client, and diagnostic commands.

### Global daemon

One per-user Node.js daemon binds only to `127.0.0.1`. It manages a registry of project roots, allocates a stable project ID, resolves the project configuration, serializes board writes, schedules jobs, supervises `tmux`, and serves the built React application.

The daemon exposes:

- REST endpoints for project, ticket, runner, and lifecycle operations
- a WebSocket event stream for browser and terminal clients
- a local MCP bridge for typed agent operations
- health and readiness endpoints

The daemon uses a lock and PID file under the user's application-support directory to guarantee one active instance. It chooses a configured fixed port when available and records the actual loopback URL for hooks and clients.

### Project configuration and runtime state

`.agents-runners/config.json` is the readable project source of truth. It contains project settings and the complete ticket list. The daemon is the sole writer while active and uses atomic temporary-file replacement. A file watcher imports valid manual edits. Invalid edits do not replace the last valid in-memory board and create a visible configuration error.

High-volume and process-specific data lives under `.agents-runners/runtime/` and remains gitignored. This includes event JSONL, process metadata, Codex thread IDs, runner leases, last output, health timestamps, and retry history.

### Donna

Each project has one persistent Donna identity and Codex thread ID. Browser messages and the interactive `agents-runners donna` terminal client are serialized into that same thread. Every turn wakes Donna through `codex exec resume <thread-id> --json`, streams structured events, stores the final response, and returns Donna to Idle.

Ordinary Codex sessions can call MCP tools to read the board, send Donna a message, create tickets, and inspect runners. They do not replace Donna's canonical thread.

### Runner supervisor

Each logical runner has a stable ID, role, `tmux` pane, worktree, branch, environment-file set, Codex thread ID, and status. A runner is provisioned lazily up to the configured role limit and remains available after the job completes.

A job wakes a runner by executing `codex exec resume <thread-id> --json` inside its persistent `tmux` pane. If the runner has no thread yet, the supervisor starts a new `codex exec --json` conversation and records its thread ID. The subprocess exits after the turn; the logical runner, pane, worktree, and thread remain Idle and resumable.

## Configuration model

The versioned configuration contains these top-level areas:

- `project`: stable ID, display name, repository root, integration branch, and optional remote.
- `server`: preferred host and port. Host is loopback-only in version 1.
- `board`: ordered columns and tickets.
- `automation`: enabled state, actionable statuses, retry limit, auto-merge, auto-push, and concurrency.
- `pools`: role definitions, limits, models, reasoning effort, and task instructions.
- `worktrees`: root convention, persistence, and branch prefixes.
- `environments`: copyable filenames, role mappings, redaction rules, and an explicit production-access opt-in.
- `verification`: repository-specific type-check, test, lint, build, and UI test commands.
- `computerUse`: enablement and QA instructions for human-style testing.

Each ticket contains:

- stable ID and title
- Markdown description and acceptance criteria
- status, priority, type, tags, dependencies, and ordering
- preferred role or explicit runner assignment
- development and QA instructions
- environment profile
- timestamps and creator identity

Runner IDs, operating-system process IDs, Codex thread IDs, raw logs, and credentials are not stored in the main config.

The default columns are Backlog, Todo, In Progress, Review, QA, Blocked, and Done. All Work is a searchable aggregate view rather than a workflow column.

## Autonomous workflow

Backlog is inert. Done is terminal. Blocked awaits Donna or user input after automated recovery is exhausted. Todo, In Progress, Review, and QA are actionable.

When a ticket enters Todo, the scheduler checks dependencies and capacity, then assigns the requested developer or the next healthy Idle developer. Donna adds a concise execution brief derived from the ticket and project instructions. The developer fast-forwards its persistent branch from `dev`, works inside its isolated worktree, updates progress through MCP, runs required local verification, stages explicit modified files, commits, and pushes its runner branch.

The ticket moves to Review. An Idle reviewer fast-forwards its persistent review branch to the developer commit, inspects the diff and acceptance criteria, and records a structured verdict. A rejection resumes the same developer thread with the exact findings.

After review passes, the ticket moves to QA. An Idle QA runner fast-forwards its persistent QA branch to the reviewed commit, runs configured checks, and uses Computer Use when the ticket requests human-style application testing. QA records evidence without copying credentials into logs. A failure resumes the same developer thread.

The review/fix and QA/fix loop repeats up to `automation.maxRetries`, defaulting to three. Exhaustion moves the ticket to Blocked and Donna explains the blocker.

After QA passes, a serialized integration lane merges the developer commit into an isolated integration worktree tracking `dev`. It runs integration verification before pushing `dev`. Conflicts, failed checks, or rejected pushes return the ticket to the same developer or Blocked state; they never silently mark the ticket Done. A successful push moves the ticket to Done.

Moving an existing ticket directly into In Progress, Review, or QA resumes or begins the appropriate stage. Unassigned actionable tickets are claimed automatically. Explicit manual assignments take precedence. Moving an active ticket back to Backlog requests cancellation, preserves all state, and returns the runner to Idle after its current command reaches a safe stopping point.

## Git and worktree behavior

The default integration branch is `dev`, configurable per project. Initialization stops with a clear error if that branch cannot be resolved and the user has not configured another branch.

Each role slot receives a persistent worktree and branch under the repository's existing convention or `.worktrees/agents-runners/<role-id>`. Worktrees and branches are never removed automatically.

Before a new job, a clean Idle runner branch fast-forwards to the latest integration branch. A dirty or diverged runner becomes Unhealthy and is not assigned new work until Donna repairs or reports it. Reviewer and QA branches fast-forward to the exact candidate commit they inspect.

Only the integration lane can update `dev`, and it handles one ticket at a time. It fetches the remote, verifies a fast-forwardable base, merges the candidate, runs integration checks, and pushes. This avoids concurrent merges and preserves a readable commit history.

## Environment handling

Configured development environment files can be copied into runner worktrees without repeated prompts. Initialization and synchronization operate on filenames and file bytes without displaying values. The default discovery set includes `.env`, `.env.local`, and `.env.development`; production-like filenames are excluded unless the project config explicitly enables them.

Environment values are filtered from server responses, WebSocket events, stored logs, and browser rendering. Redaction covers configured literal values and common credential patterns. The board stores only the named environment profile.

Because runners execute as an outsourced development team, their Codex turns use full local permissions with approvals disabled when `automation.fullAccess` is enabled. The default generated project config records this choice visibly. Computer Use still follows action-time confirmation requirements for irreversible, financial, credential-expanding, or sensitive-data transmission actions.

## MCP interface

The local MCP server exposes small, typed tools:

- `get_project`
- `get_board`
- `get_ticket`
- `create_ticket`
- `update_ticket`
- `move_ticket`
- `assign_ticket`
- `claim_next_ticket`
- `add_ticket_comment`
- `report_progress`
- `complete_stage`
- `list_runners`
- `get_runner`
- `message_donna`
- `get_activity`

Every write includes an expected revision to prevent silent lost updates. Tool responses return the new revision and a concise state summary.

## User interface

The selected layout is board-first. The application uses a pure white visual system inspired by the clarity and restraint of the ChatGPT interface:

- Outfit typography, near-black text, muted gray secondary text, pale column surfaces, and thin neutral borders.
- A minimal top command bar with project switching, search, connection state, and agent capacity.
- A wide Kanban canvas with compact, information-rich cards and no decorative gradients or visual clutter.
- A persistent Donna rail on the right with shared-thread chat, current decisions, blockers, and a compact composer.
- A collapsible runner inspector showing role, status, ticket, branch, worktree, retry count, and live terminal events.
- A ticket detail drawer for description, acceptance criteria, comments, dependencies, environment, assignment, and run history.
- Drag-and-drop, keyboard navigation, command palette, filtering, and explicit pause/resume controls.

GSAP powers restrained, functional motion: board entry, card movement confirmation, Donna rail transitions, stacked activity cards, and the expandable runner inspector. Motion respects `prefers-reduced-motion`. The interface never displays raw secrets or unbounded terminal output; it shows redacted, virtualized event streams.

## Error handling and recovery

- Invalid configuration: retain the last valid board and show the exact schema path that failed.
- Daemon crash: SessionStart, CLI, or browser reconnect restarts it from persisted state.
- Stale process metadata: validate PID ownership and health before reuse.
- Runner crash: mark Unhealthy, preserve logs and thread ID, then retry once before Donna escalates.
- Lost WebSocket: fall back to revision polling and reconcile on reconnect.
- Concurrent edits: reject stale revisions and return the current ticket for retry.
- Worktree dirty or branch diverged: quarantine that runner; never overwrite its files.
- Merge conflict: keep the candidate branch, resume the same developer, and record conflict paths.
- Test failure: attach the command, exit code, and redacted tail to the ticket, then enter the fix loop.
- Push failure: keep the ticket out of Done and retry only after refreshing remote state.
- Missing `tmux`, Node, Git, Codex authentication, plugin, or Computer Use capability: `doctor` reports an actionable diagnosis before automation starts.

## Verification strategy

Development follows test-driven implementation because Superpowers was explicitly requested.

- Unit tests cover schemas, atomic config writes, transitions, dependency eligibility, scheduler fairness, retry rules, revision conflicts, redaction, and command construction.
- Integration tests use temporary Git repositories and a fake Codex executable to validate initialization, persistent worktrees, runner wake/idle cycles, review/QA loops, merge serialization, and recovery.
- MCP protocol tests exercise every tool and stale-revision behavior.
- API and WebSocket tests validate board mutations and event ordering.
- React component tests cover board rendering, Donna chat, runner states, config errors, and keyboard interactions.
- Browser tests cover drag-to-Todo auto-start, ticket editing, live progress, failure loops, and Done after a successful integration push.
- A final macOS smoke test uses a temporary repository and safe fake credentials. Real client repositories, production environment files, and production databases are excluded unless separately and explicitly authorized.

The release gate runs TypeScript type checking, unit and integration tests, frontend build, browser tests, plugin validation, and a CLI doctor smoke test.

## Distribution and updates

The plugin manifest includes the skill, local MCP server, interface metadata, and built assets. The personal marketplace entry uses the standard `AVAILABLE` and `ON_INSTALL` policy. Local development updates use the plugin-creator cachebuster script followed by reinstalling `agents-runners@personal` and testing in a new Codex thread.

## Success criteria

The first release is complete when an initialized temporary Git project can start Codex, automatically open Agents Runners, accept a ticket through browser or MCP, move it from Todo through development, review, QA, integration, push, and Done, preserve all runner worktrees and threads in Idle state, and show the same Donna conversation in browser and terminal.
