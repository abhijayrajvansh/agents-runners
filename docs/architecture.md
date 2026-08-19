# Architecture

Agents Runners uses one loopback Node.js daemon for every initialized local project. Work is modelled as skill-flow issues: planning and triage produce fully-specified `ready_for_agent` issues (or wayfinder decision tickets for un-specable efforts), and the delivery engine below implements them one vertical slice at a time with persistent Codex runners.

```text
Codex CLI / Browser / Terminal
            │
     REST + WebSocket + MCP
            │
   127.0.0.1 daemon and Donna
            │
   deterministic ticket scheduler
      ┌─────┼─────────┐
 Developer Reviewer   QA
      │       │        │
 persistent tmux panes + Codex threads
 persistent Git worktrees and branches
      └─────┬─────────┘
      serialized integrator → dev → origin
```

## Sources of truth

- `.agents-runners/config.json` stores the visible project configuration and complete Kanban board.
- `.agents-runners/runtime/project-runtime.json` stores retry counts, runner affinity, integration commits, Donna’s thread ID, and runner thread IDs.
- the user runtime directory stores daemon PID metadata and the set of registered project roots.
- WebSocket event history is bounded and ephemeral; it accelerates UI updates but never replaces the board.

## Ticket delivery

The scheduler serializes reconciliation per project while allowing independent runner stages to execute concurrently within role caps. Dependencies must be Done before a ticket is eligible.

1. Todo claims a Developer and moves to In Progress.
2. A clean persistent developer branch synchronizes with the integration branch. Codex implements, verifies, commits, and leaves the worktree clean.
3. Review inspects the exact developer candidate without editing it.
4. QA validates the same candidate, using Computer Use when configured.
5. Failures return to the original developer thread. Retry exhaustion moves the ticket to Blocked.
6. A QA pass enters the serialized integration lane, runs configured verification, pushes `dev`, and moves the ticket to Done.

Role worktrees and thread IDs remain intact when Idle. Managed reviewer and QA worktrees may point exactly at different candidate branches between tickets; user worktrees are never changed.

## Donna

Donna owns one persistent Codex thread per project. Browser, terminal, and MCP messages are serialized into it. Donna reads and writes the same board through revision-protected MCP tools, so ordinary Codex sessions and the GUI observe identical state.

## Process and security boundaries

- The HTTP and WebSocket server rejects non-loopback binding.
- tmux owns long-lived logical runner panes; individual `codex exec --json` turns may exit while the runner remains Idle.
- Codex JSONL events are tailed during execution, normalized, redacted, and published to local clients.
- Development environment values are copied without display and filtered from structured outputs.
- Only the integrator can push the configured integration branch.
- Shutdown releases the daemon lock but preserves project runtime, worktrees, branches, panes, and Codex threads.
