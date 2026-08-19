# Autonomous Delivery and Human Review Design

## Goal

Make Codex Runners genuinely autonomous while keeping the browser optional, make Donna chat reliable, and simplify delivery to a human-controlled final Review stage with an explicit Merge action.

## Scope

This change covers:

- the canonical ticket status model and migration of existing project state;
- daemon heartbeat, overlap protection, browser polling, and WebSocket reconnect;
- Donna's task-creation contract and streamed chat recovery;
- QA-to-Review delivery behavior;
- human-controlled merge of a delivery branch into the configured integration branch;
- unit, integration, and end-to-end verification of the complete flow.

This change does not add a remote queue, hosted worker service, or automatic merge.

## Canonical Workflow

The canonical project statuses are:

```text
backlog -> todo -> in_progress -> qa -> review
```

`blocked` is an interrupt state and may resume to `todo`.

- `backlog` is passive and is used for ideas or planning-only work.
- `todo` starts autonomous delivery.
- `in_progress` is the developer stage.
- `qa` is the automated QA runner stage.
- `review` is the final human stage.
- `blocked` waits for a dependency or human decision.

The following statuses are removed from the public schema, MCP tools, UI, and generated project configuration:

```text
needs_triage
needs_info
ready_for_agent
ready_for_human
wontfix
done
```

Existing state is migrated before strict schema validation:

- `needs_triage`, `needs_info`, `ready_for_human`, and `wontfix` become `backlog`.
- `ready_for_agent` becomes `todo`.
- `done` becomes `review`.
- Existing delivery metadata is retained.

The migration is idempotent and must not overwrite ticket history, comments, branches, or merge metadata.

## State Transitions

Allowed automated transitions:

- `todo -> in_progress`
- `in_progress -> qa`
- `qa -> review`
- a failed developer, QA, or review-related correction returns to `in_progress` until retry exhaustion;
- any actionable state may become `blocked` when a dependency or human decision stops execution;
- `blocked -> todo` resumes work;
- `backlog -> todo` is an explicit human or Donna action.

Review is not an autonomous stage. The scheduler must not claim Review tickets after QA passes. Reviewer evidence may be recorded as comments or findings before the ticket reaches Review, but the human controls the final merge.

## Delivery and Merge

After QA passes:

1. seal or retain the delivery branch;
2. set `runtime.mergeState = "ready"`;
3. move the ticket to `review`;
4. stop the scheduler for that ticket.

The existing serialized integration service remains the merge implementation. It merges the delivery branch into `project.integrationBranch` using the integration worktree, runs configured verification commands, pushes when `automation.autoPush` is enabled, and records the resulting commit.

The merge endpoint and UI are valid only when:

- the ticket status is `review`;
- the delivery branch exists;
- `mergeState` is `ready` or `failed`;
- the ticket has a developer delivery identity.

On success:

- set `mergeState = "merged"`;
- record `integrationCommit`;
- remove the delivery branch;
- leave the ticket in `review` with a merged indicator.

On failure:

- set `mergeState = "failed"`;
- retain the ticket in `review`;
- retain the delivery branch;
- expose a retry action and redacted error message.

Dependencies are complete only when their runtime merge state is `merged`. A ticket in Review, including one with `mergeState = "ready"`, must not unblock dependents.

## Autonomous Runtime

The daemon owns autonomous execution. The browser is an observer and control surface, not the scheduler.

Each registered project has a heartbeat that:

- runs on the existing short interval;
- prevents overlapping reconcile calls for the same project;
- records last heartbeat time, last successful reconcile time, and latest error;
- emits an automation heartbeat/status event;
- continues to schedule actionable tickets after browser disconnects.

Heartbeat failures are surfaced as project errors without terminating the daemon or disabling future ticks.

The browser state layer:

- consumes WebSocket events when connected;
- reconnects with bounded backoff after close or error;
- replays from the last event sequence on reconnect;
- polls project, runners, deliveries, and Donna history while the socket is disconnected or stale;
- clears the stale/error state after a successful refresh.

## Donna Contract

Donna remains a persistent project manager and never edits source files or implements tickets directly.

When the user asks Donna to create work:

- Donna follows the Superpowers `/to-tickets` workflow;
- Donna creates a clear vertical-slice ticket using the project ticket tool;
- implementation requests are created in `todo`;
- ideas, planning requests, and explicitly deferred work are created in `backlog`;
- Donna uses only the canonical statuses in replies and tool calls;
- Donna explains the created ticket and whether it is passive or autonomous.

Donna requests remain serialized per project and reuse the persisted thread ID. The streamed NDJSON chat endpoint remains the transport, with client recovery that refreshes persisted history after stream errors or reconnects. A failed turn must not create duplicate user or Donna messages.

## Configuration Compatibility

The project loader must normalize legacy configuration before parsing the strict schema. This includes legacy status lists, old actionable status lists, and the existing Donna timeout field. The normalized config is written back through the project store with a revision-safe update. Production environment files remain excluded.

## UI Contract

The Board renders only:

```text
Backlog, Todo, In progress, QA, Review, Blocked
```

Manual drag/drop is allowed only for passive or recovery actions. Active runner stages remain locked. Review cards expose Merge, Merging, Retry merge, or Merged states. No Done counter, Done column, or legacy triage labels remain.

The ticket drawer, board counters, activity text, MCP descriptions, and Donna replies use the same status vocabulary.

## Verification

Required verification includes:

- type checking;
- schema and migration tests;
- state-machine and scheduler tests;
- heartbeat overlap and failure recovery tests;
- Donna task creation, status selection, serialization, and stream recovery tests;
- WebSocket reconnect and polling fallback tests;
- merge endpoint guards and integration success/failure tests;
- dependency unblocking only after merged delivery;
- UI and end-to-end coverage for `Backlog -> Todo -> In progress -> QA -> Review -> Merge`.

## Non-Goals

- automatic merge without human action;
- deleting persistent runner worktrees;
- introducing unmanaged worker processes;
- changing production environment handling;
- making the browser responsible for autonomous scheduling.
