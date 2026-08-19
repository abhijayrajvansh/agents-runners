# Autonomous Delivery and Human Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Codex Runners autonomous without a browser, make Donna chat and task creation reliable, and end delivery at a human-controlled Review stage with an explicit Merge action.

**Architecture:** Normalize legacy project configuration before strict parsing, then use one canonical status model across schema, state machine, scheduler, MCP, UI, and tests. Keep scheduling in the daemon with guarded heartbeats, while the browser observes through WebSocket events plus polling/reconnect fallback. QA moves tickets to Review with merge-ready delivery metadata; only the Review Merge action invokes the serialized integration service.

**Tech Stack:** TypeScript, Zod, Express, WebSocket (`ws`), React, Vitest, Playwright, Git worktrees, existing Codex/MCP runner services.

**Spec:** `docs/superpowers/specs/2026-08-19-autonomous-delivery-review-design.md`

## Global Constraints

- Canonical statuses are `backlog`, `todo`, `in_progress`, `qa`, `review`, and `blocked`.
- `Backlog` is passive; `Todo` starts autonomous execution.
- `Review` is the final human stage; successful merges remain in Review with merge metadata.
- No automatic merge and no `Done` status.
- Heartbeat execution must not depend on the browser.
- Donna uses the Superpowers `/to-tickets` workflow for task creation and remains a project manager.
- Existing runner worktrees, branches, threads, and environment protections remain persistent.
- Never read, print, or commit environment-file secrets.

---

### Task 1: Normalize configuration and canonicalize statuses

**Files:**
- Modify: `src/domain/schema.ts`
- Modify: `src/storage/atomic-json-store.ts` or the project-loading boundary that parses `ProjectConfigSchema`
- Modify: `src/server/project-registry.ts`
- Modify: `src/init/config-template.ts`
- Modify: `src/init/initialize-project.ts`
- Modify: `.codex-runners/config.json` through the project store/migration path, not by hard-coded secret reads
- Test: `tests/unit/schema.test.ts`
- Test: `tests/integration/init.test.ts`
- Test: add a focused migration test under `tests/unit/` if the loader boundary is not already covered

**Interfaces:**
- Consumes legacy config objects containing old status lists and optional Donna timeout.
- Produces a normalized `ProjectConfig` with canonical columns/actionable statuses and preserved ticket/runtime metadata.

- [ ] **Step 1: Write failing schema/migration tests**

  Add tests that parse a legacy config with `needs_triage`, `ready_for_agent`, and `done`, assert canonical columns, and verify `timeoutMs` remains accepted. Add a test that migration is idempotent and preserves ticket comments, delivery branch, and merge state.

- [ ] **Step 2: Run focused tests and verify failure**

  Run:

  ```bash
  npm test -- --run tests/unit/schema.test.ts tests/integration/init.test.ts
  ```

  Expected: failures showing legacy status values are rejected or remain in the resulting config.

- [ ] **Step 3: Implement normalization before strict parsing**

  Add a pure normalization function near the config-loading boundary. Map:

  ```text
  needs_triage, needs_info, ready_for_human, wontfix -> backlog
  ready_for_agent -> todo
  done -> review
  ```

  Normalize `board.columns` and `automation.actionableStatuses`, remove duplicates while preserving order, default to `backlog,todo,in_progress,qa,review,blocked`, and parse the normalized object with `ProjectConfigSchema`.

- [ ] **Step 4: Update generated project configuration and managed instructions**

  Make new projects use the canonical columns/statuses. Update Donna/skill instructions so they refer to `todo` and `review`, never legacy statuses.

- [ ] **Step 5: Run focused tests and typecheck**

  Run:

  ```bash
  npm test -- --run tests/unit/schema.test.ts tests/integration/init.test.ts
  npm run typecheck
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add src/domain/schema.ts src/storage/atomic-json-store.ts src/server/project-registry.ts src/init/config-template.ts src/init/initialize-project.ts tests/unit/schema.test.ts tests/integration/init.test.ts
  git commit -m "fix: migrate projects to canonical statuses"
  ```

### Task 2: Update state machine, scheduler, MCP, and merge boundary

**Files:**
- Modify: `src/orchestration/state-machine.ts`
- Modify: `src/orchestration/scheduler.ts`
- Modify: `src/orchestration/automation-manager.ts`
- Modify: `src/mcp/tools.ts`
- Modify: `src/mcp/server.ts`
- Modify: `src/server/app.ts`
- Modify: `src/runtime/project-runtime.ts` only if delivery/heartbeat state needs a typed addition
- Test: `tests/unit/state-machine.test.ts`
- Test: `tests/unit/scheduler.test.ts`
- Test: `tests/integration/autonomous-workflow.test.ts`
- Test: `tests/integration/integration-git.test.ts`
- Test: `tests/integration/mcp.test.ts`

**Interfaces:**
- Consumes canonical tickets and runner execution results.
- Produces `qa -> review` transitions, merge-ready delivery state, guarded merge endpoint behavior, and MCP status validation.

- [ ] **Step 1: Write failing transition and dependency tests**

  Update tests to expect:

  ```text
  in_progress + passed -> qa
  qa + passed -> review
  review + passed -> error/no autonomous transition
  ```

  Add tests that dependencies remain blocked until `mergeState === "merged"` and that a ticket in Review cannot be claimed by the scheduler.

- [ ] **Step 2: Run focused tests and verify failure**

  ```bash
  npm test -- --run tests/unit/state-machine.test.ts tests/unit/scheduler.test.ts tests/integration/autonomous-workflow.test.ts
  ```

- [ ] **Step 3: Implement canonical state transitions**

  Replace legacy transition entries, make QA success move to Review, and leave Review outside `roleForStatus`/eligible automation. Update completed dependency checks to use merged delivery state rather than `done`.

- [ ] **Step 4: Move merge readiness to Review**

  In `AutomationManager`, initialize merge interruption recovery from Review tickets, accept merge only for `review`, and preserve Review after successful merge. Keep branch removal after successful integration only.

- [ ] **Step 5: Update MCP and HTTP guards**

  Make `statusInput`, `claim_next_ticket`, tool descriptions, and active-ticket edit locks use only canonical statuses. Reject merge requests unless the ticket is in Review with a delivery branch and a ready/failed merge state.

- [ ] **Step 6: Run focused tests and typecheck**

  ```bash
  npm test -- --run tests/unit/state-machine.test.ts tests/unit/scheduler.test.ts tests/integration/autonomous-workflow.test.ts tests/integration/integration-git.test.ts tests/integration/mcp.test.ts
  npm run typecheck
  ```

- [ ] **Step 7: Commit**

  ```bash
  git add src/orchestration/state-machine.ts src/orchestration/scheduler.ts src/orchestration/automation-manager.ts src/mcp/tools.ts src/mcp/server.ts src/server/app.ts src/runtime/project-runtime.ts tests/unit/state-machine.test.ts tests/unit/scheduler.test.ts tests/integration/autonomous-workflow.test.ts tests/integration/integration-git.test.ts tests/integration/mcp.test.ts
  git commit -m "feat: stop delivery at human review"
  ```

### Task 3: Add guarded heartbeat health and browser recovery

**Files:**
- Modify: `src/orchestration/automation-manager.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/event-bus.ts` only if a typed heartbeat event helper is useful
- Modify: `web/src/api/socket.ts`
- Modify: `web/src/state/use-project.ts`
- Modify: `web/src/api/client.ts` only for refresh/retry helpers
- Test: `tests/unit/automation-manager.test.ts` or a new focused unit test
- Test: `tests/integration/websocket.test.ts`
- Test: `web/src/api/client.test.ts`
- Test: add a focused socket/reconnect test under `web/src/` if the existing test setup supports it

**Interfaces:**
- Consumes daemon scheduler status and event sequence numbers.
- Produces heartbeat status events, reconnecting WebSocket client behavior, and polling fallback state refreshes.

- [ ] **Step 1: Write failing heartbeat overlap/failure tests**

  Test that a slow reconcile does not overlap with the next interval, that a failed tick emits an automation error, and that a later tick still runs.

- [ ] **Step 2: Implement a per-project heartbeat guard**

  Keep the daemon-owned interval, but route each tick through a per-project in-flight promise/flag. Record last heartbeat and last success/error in memory or typed runtime state, and emit a compact status event without exposing secrets.

- [ ] **Step 3: Write failing WebSocket reconnect/polling tests**

  Test that close/error schedules a bounded reconnect using the latest event sequence and that polling refreshes state while disconnected, then stops or slows when the socket is healthy.

- [ ] **Step 4: Implement socket reconnect and polling fallback**

  Extend `connectProjectSocket` with cleanup-safe backoff and reconnect callbacks. In `useProject`, refresh on a bounded interval while disconnected/stale and prevent duplicate refreshes.

- [ ] **Step 5: Run focused tests and typecheck**

  ```bash
  npm test -- --run tests/integration/websocket.test.ts web/src/api/client.test.ts
  npm run typecheck
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add src/orchestration/automation-manager.ts src/server/app.ts src/server/event-bus.ts web/src/api/socket.ts web/src/state/use-project.ts web/src/api/client.ts tests/integration/websocket.test.ts web/src/api/client.test.ts
  git commit -m "fix: keep automation and board updates alive"
  ```

### Task 4: Make Donna task creation and chat recovery reliable

**Files:**
- Modify: `src/donna/donna-service.ts`
- Modify: `src/init/initialize-project.ts`
- Modify: `web/src/state/use-project.ts`
- Modify: `web/src/api/client.ts`
- Modify: `web/src/components/donna-rail.tsx` only for visible retry/status state
- Test: `tests/integration/donna.test.ts`
- Test: `web/src/components/donna-rail.test.tsx`
- Test: `web/src/api/client.test.ts`

**Interfaces:**
- Consumes user messages and the persistent Donna thread.
- Produces canonical tickets, Superpowers workflow instructions, serialized stream events, and persisted chat history without duplicates.

- [ ] **Step 1: Write failing Donna tests**

  Add tests for:

  - implementation request -> `todo`;
  - planning/idea request -> `backlog`;
  - prompt includes `/to-tickets` and canonical workflow;
  - two concurrent sends are serialized;
  - stream error refreshes history and does not duplicate messages.

- [ ] **Step 2: Implement Donna’s explicit ticket contract**

  Replace legacy status replies and direct “ready_for_agent” creation with canonical status selection. Keep `source: "donna"` and vertical-slice acceptance criteria. In the prompt, explicitly require the Superpowers `/to-tickets` workflow for task creation and forbid coding/merging by Donna.

- [ ] **Step 3: Harden browser chat state**

  Track one optimistic user message per request, ignore duplicate streamed events already persisted, refresh history after errors, and expose a retryable error state without creating fake Donna replies.

- [ ] **Step 4: Run focused tests and typecheck**

  ```bash
  npm test -- --run tests/integration/donna.test.ts web/src/components/donna-rail.test.tsx web/src/api/client.test.ts
  npm run typecheck
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add src/donna/donna-service.ts src/init/initialize-project.ts web/src/state/use-project.ts web/src/api/client.ts web/src/components/donna-rail.tsx tests/integration/donna.test.ts web/src/components/donna-rail.test.tsx web/src/api/client.test.ts
  git commit -m "fix: make Donna task creation reliable"
  ```

### Task 5: Update Board, drawer, counters, and Review Merge UI

**Files:**
- Modify: `web/src/components/board.tsx`
- Modify: `web/src/components/column.tsx`
- Modify: `web/src/components/ticket-card.tsx`
- Modify: `web/src/components/ticket-drawer.tsx`
- Modify: `web/src/app.tsx`
- Modify: `web/src/styles.css`
- Modify: `web/src/test/project-fixture.ts`
- Test: `web/src/components/board.test.tsx`
- Test: add/update ticket card tests if needed
- Test: `tests/e2e/board-workflow.spec.ts`
- Test: `tests/e2e/fixture-server.ts`

**Interfaces:**
- Consumes canonical project config, runner snapshots, deliveries, and merge callbacks.
- Produces a six-column board with Review as the last stage and human-only Merge controls.

- [ ] **Step 1: Write failing UI tests**

  Update the board test and E2E fixture to assert the six canonical columns, no Done/triage labels, QA before Review, and a Merge button in Review.

- [ ] **Step 2: Update board and card status maps**

  Remove legacy labels, make only Backlog/Blocked recoverable by drag/drop, and remove Done counters. Change next-stage actions to `Backlog -> Todo`, `Blocked -> Todo`, and no automatic action from Review.

- [ ] **Step 3: Move merge controls to Review**

  Render ready/merging/failed/merged controls when `ticket.status === "review"`. Keep the merge target as the configured integration branch and show retry/error states without moving the ticket.

- [ ] **Step 4: Update drawer and accessibility text**

  Remove legacy status options, lock active stages, and allow editing/recovery only for passive or blocked tickets. Ensure the final Review stage and Merge action have stable accessible names.

- [ ] **Step 5: Run UI tests and typecheck**

  ```bash
  npm test -- --run web/src/components/board.test.tsx web/src/components/donna-rail.test.tsx
  npm run typecheck
  npm run build
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add web/src/components/board.tsx web/src/components/column.tsx web/src/components/ticket-card.tsx web/src/components/ticket-drawer.tsx web/src/app.tsx web/src/styles.css web/src/test/project-fixture.ts web/src/components/board.test.tsx tests/e2e/board-workflow.spec.ts tests/e2e/fixture-server.ts
  git commit -m "feat: add human review merge controls"
  ```

### Task 6: Full verification and managed-project migration

**Files:**
- Modify only migration/config output files that the earlier tasks identify as required.
- Test: all existing unit, integration, and E2E suites.
- Documentation: update `docs/configuration.md`, `docs/architecture.md`, and `README.md` status/usage sections.

**Interfaces:**
- Consumes all previous task outputs.
- Produces a documented, buildable, tested project with the current `.codex-runners` state normalized through the supported loader.

- [ ] **Step 1: Update documentation**

  Replace legacy workflow language with the canonical flow and explain that Review is the final human stage with Merge.

- [ ] **Step 2: Run the complete verification gate**

  ```bash
  npm run typecheck
  npm test
  npm run build
  npm run test:e2e
  ```

- [ ] **Step 3: Inspect the managed project through Codex Runners**

  Run the project registration/status checks and confirm that `get_project` and `get_board` no longer reject the current config. Do not print environment values.

- [ ] **Step 4: Run final diff and status checks**

  ```bash
  git diff --check
  git status --short --branch
  ```

- [ ] **Step 5: Commit documentation and final fixes**

  ```bash
  git add README.md docs/configuration.md docs/architecture.md
  git commit -m "docs: document autonomous review delivery"
  ```

