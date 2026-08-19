# Agents Runners Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a macOS-first personal Codex plugin that provides a local bidirectional Kanban board, persistent Donna project-manager thread, and autonomous persistent Codex runner pools.

**Architecture:** A bundled Node.js daemon serves REST, WebSocket, MCP, and a React application for multiple initialized projects. Project-local JSON config remains the readable board source of truth, while injected Git, tmux, and Codex adapters let a deterministic scheduler move tickets through development, review, QA, integration, and Done.

**Tech Stack:** Node.js 24, TypeScript 5, Express 5, ws, Zod, Commander, MCP TypeScript SDK, React 19, Vite, dnd-kit, GSAP, Vitest, Testing Library, Supertest, Playwright, tsup.

**Spec:** `docs/superpowers/specs/2026-08-18-agents-runners-design.md`

## Global Constraints

- Target macOS only in version 1; require Node.js 22 or newer, Git, tmux, and an authenticated Codex CLI.
- Bind the daemon only to `127.0.0.1`; never expose a non-loopback listener.
- Use `.agents-runners/config.json` as the atomic, human-readable board source of truth.
- Keep `.agents-runners/runtime/`, copied environment files, raw events, PID data, and thread IDs out of Git.
- Use persistent runner worktrees and branches; never delete them automatically.
- Default integration branch to `dev`; only the serialized integration lane may push it.
- Default role limits to five Developers, five Reviewers, and five QA runners.
- Backlog is inert; Todo, In Progress, Review, and QA are actionable; Blocked and Done do not start new work.
- Resume the same developer after review or QA failure and block after three unsuccessful fix loops.
- Use full local Codex permissions only when the visible project config sets `automation.fullAccess` to `true`.
- Do not put secret values in config, REST responses, WebSocket events, MCP responses, logs, or browser output.
- Follow test-driven development: observe each focused test fail before adding its implementation.
- Inline execution only; do not dispatch subagents.

---

### Task 1: Toolchain, domain types, and atomic configuration

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsup.config.ts`
- Create: `vitest.config.ts`
- Create: `src/domain/types.ts`
- Create: `src/domain/schema.ts`
- Create: `src/storage/atomic-json-store.ts`
- Test: `tests/unit/schema.test.ts`
- Test: `tests/unit/atomic-json-store.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `ProjectConfigSchema`, `ProjectConfig`, `Ticket`, `TicketStatus`, `RoleName`, `AtomicJsonStore<T>`.
- Produces: `load(): Promise<T>`, `write(next: T, expectedRevision?: number): Promise<T>`, and `watch(listener): () => void`.

- [ ] **Step 1: Add the Node/TypeScript build and test manifests**

```json
{
  "name": "agents-runners",
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=22" },
  "bin": { "agents-runners": "dist/bin/cli.mjs" },
  "scripts": {
    "build": "npm run build:node && npm run build:web",
    "build:node": "tsup",
    "build:web": "vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "gate": "npm run typecheck && npm test && npm run build && npm run test:e2e"
  }
}
```

- [ ] **Step 2: Write schema tests for defaults, valid tickets, invalid statuses, and secret-shaped fields**

```ts
const parsed = ProjectConfigSchema.parse({
  version: 1,
  project: { id: "demo", name: "Demo", repositoryRoot: repo, integrationBranch: "dev" },
  board: { revision: 0, tickets: [] }
});
expect(parsed.pools.developer.max).toBe(5);
expect(parsed.automation.maxRetries).toBe(3);
expect(() => ProjectConfigSchema.parse(withStatus("unknown"))).toThrow();
expect(() => ProjectConfigSchema.parse({ ...valid, apiKey: "secret" })).toThrow();
```

- [ ] **Step 3: Run schema tests and verify the missing-module failure**

Run: `npm test -- tests/unit/schema.test.ts`

Expected: FAIL because `src/domain/schema.ts` does not exist.

- [ ] **Step 4: Implement strict Zod schemas and exported inferred types**

```ts
export const TicketStatusSchema = z.enum(["backlog", "todo", "in_progress", "review", "qa", "blocked", "done"]);
export const RoleNameSchema = z.enum(["developer", "reviewer", "qa"]);
export const TicketSchema = z.object({
  id: z.string().min(1), title: z.string().min(1), description: z.string().default(""),
  acceptanceCriteria: z.array(z.string()).default([]), status: TicketStatusSchema,
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  type: z.enum(["feature", "bug", "test", "review", "chore"]).default("feature"),
  tags: z.array(z.string()).default([]), dependencies: z.array(z.string()).default([]),
  preferredRole: RoleNameSchema.optional(), assignedRunnerId: z.string().optional(),
  developmentInstructions: z.string().default(""), qaInstructions: z.string().default(""),
  environment: z.string().default("development"), createdAt: z.string(), updatedAt: z.string()
}).strict();
```

- [ ] **Step 5: Write atomic-store tests for creation, revision conflicts, invalid external edits, and file watching**

```ts
const store = new AtomicJsonStore(file, ProjectConfigSchema);
const first = await store.write(config, 0);
expect(first.board.revision).toBe(1);
await expect(store.write(first, 0)).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
await fs.writeFile(file, "{broken");
await expect(store.load()).rejects.toMatchObject({ code: "INVALID_CONFIG" });
```

- [ ] **Step 6: Run atomic-store tests and verify they fail**

Run: `npm test -- tests/unit/atomic-json-store.test.ts`

Expected: FAIL because `AtomicJsonStore` is missing.

- [ ] **Step 7: Implement queued atomic writes with temp-file rename and typed errors**

```ts
async write(next: T, expectedRevision?: number): Promise<T> {
  return this.enqueue(async () => {
    const current = await this.loadOrNull();
    if (expectedRevision !== undefined && current?.board.revision !== expectedRevision) {
      throw new StoreError("REVISION_CONFLICT", "Board revision changed");
    }
    const parsed = this.schema.parse(withNextRevision(next, current));
    await fs.writeFile(this.tempPath, JSON.stringify(parsed, null, 2) + "\n", { mode: 0o600 });
    await fs.rename(this.tempPath, this.filePath);
    return parsed;
  });
}
```

- [ ] **Step 8: Install dependencies, run focused tests, type-check, and commit**

Run: `npm install`

Run: `npm test -- tests/unit/schema.test.ts tests/unit/atomic-json-store.test.ts && npm run typecheck`

Expected: PASS.

```bash
git add package.json package-lock.json tsconfig.json tsup.config.ts vitest.config.ts .gitignore src/domain/types.ts src/domain/schema.ts src/storage/atomic-json-store.ts tests/unit/schema.test.ts tests/unit/atomic-json-store.test.ts
git commit -m "feat: add validated atomic project configuration"
```

### Task 2: Project initializer and native SessionStart hook

**Files:**
- Create: `src/platform/paths.ts`
- Create: `src/platform/project-discovery.ts`
- Create: `src/init/config-template.ts`
- Create: `src/init/managed-files.ts`
- Create: `src/hooks/session-start.ts`
- Create: `src/cli/index.ts`
- Test: `tests/integration/init.test.ts`
- Test: `tests/unit/managed-files.test.ts`

**Interfaces:**
- Consumes: `ProjectConfigSchema`, `AtomicJsonStore<ProjectConfig>`.
- Produces: `initializeProject(root, options): Promise<InitResult>` and `handleSessionStart(input): Promise<HookOutput>`.

- [ ] **Step 1: Write initialization tests using a temporary Git repository**

```ts
await git(temp, "init", "-b", "dev");
await fs.writeFile(path.join(temp, "AGENTS.md"), "# Existing rules\n");
const result = await initializeProject(temp, { pluginRoot, openBrowser: false });
expect(result.config.project.integrationBranch).toBe("dev");
expect(await read(".agents-runners/config.json")).toContain('"fullAccess": true');
expect(await read("AGENTS.md")).toContain("<!-- agents-runners:start -->");
expect(JSON.parse(await read(".codex/hooks.json")).hooks.SessionStart).toHaveLength(1);
```

- [ ] **Step 2: Run the initializer tests and verify they fail**

Run: `npm test -- tests/integration/init.test.ts tests/unit/managed-files.test.ts`

Expected: FAIL because the initializer is missing.

- [ ] **Step 3: Implement repository discovery and the full-access default config template**

```ts
export function createProjectConfig(input: InitInput): ProjectConfig {
  return ProjectConfigSchema.parse({
    version: 1,
    project: { id: slugWithHash(input.name, input.root), name: input.name, repositoryRoot: input.root, integrationBranch: input.branch },
    board: { revision: 0, tickets: [] },
    automation: { enabled: true, fullAccess: true, maxRetries: 3, autoMerge: true, autoPush: true },
    pools: { developer: { max: 5 }, reviewer: { max: 5 }, qa: { max: 5 } }
  });
}
```

- [ ] **Step 4: Implement idempotent managed blocks for AGENTS.md, hooks.json, and .gitignore**

```ts
const hook = {
  matcher: "startup|resume",
  hooks: [{ type: "command", command: `${quote(process.execPath)} ${quote(cliPath)} hook session-start`, timeout: 10, statusMessage: "Starting Agents Runners" }]
};
mergeHookByCommand(existing, "SessionStart", hook);
replaceManagedBlock(agentsPath, "agents-runners", agentsInstructions);
appendUniqueLines(gitignorePath, [".agents-runners/runtime/", ".agents-runners/**/*.env"]);
```

- [ ] **Step 5: Implement the Commander CLI and SessionStart JSON input/output**

```ts
program.command("init").option("--root <path>", "project root", process.cwd()).action(runInit);
program.command("hook").command("session-start").action(async () => {
  const input = JSON.parse(await readStdin());
  const output = await handleSessionStart(input);
  process.stdout.write(JSON.stringify(output));
});
```

- [ ] **Step 6: Run the focused tests and type-check**

Run: `npm test -- tests/integration/init.test.ts tests/unit/managed-files.test.ts && npm run typecheck`

Expected: PASS and a second initialization leaves one managed block and one matching hook.

- [ ] **Step 7: Commit**

```bash
git add src/platform/paths.ts src/platform/project-discovery.ts src/init/config-template.ts src/init/managed-files.ts src/hooks/session-start.ts src/cli/index.ts tests/integration/init.test.ts tests/unit/managed-files.test.ts
git commit -m "feat: initialize projects and session hooks"
```

### Task 3: Multi-project daemon, REST API, and WebSocket revisions

**Files:**
- Create: `src/runtime/runtime-store.ts`
- Create: `src/server/project-registry.ts`
- Create: `src/server/event-bus.ts`
- Create: `src/server/websocket-hub.ts`
- Create: `src/server/routes.ts`
- Create: `src/server/app.ts`
- Create: `src/server/daemon.ts`
- Test: `tests/integration/api.test.ts`
- Test: `tests/integration/websocket.test.ts`

**Interfaces:**
- Consumes: `AtomicJsonStore<ProjectConfig>`.
- Produces: `createApp(deps): Express`, `ProjectRegistry`, `EventBus`, `startDaemon(options): Promise<DaemonHandle>`.

- [ ] **Step 1: Write API tests for project registration, ticket CRUD, drag transitions, and stale revisions**

```ts
const created = await request(app).post(`/api/projects/${id}/tickets`).send({
  expectedRevision: 0,
  ticket: { title: "Build auth", status: "backlog", acceptanceCriteria: ["Login succeeds"] }
}).expect(201);
await request(app).patch(`/api/projects/${id}/tickets/${created.body.ticket.id}`).send({ expectedRevision: 0, status: "todo" }).expect(409);
```

- [ ] **Step 2: Run API tests and verify they fail**

Run: `npm test -- tests/integration/api.test.ts`

Expected: FAIL because `createApp` is missing.

- [ ] **Step 3: Implement registry, ticket routes, error envelopes, and health endpoints**

```ts
router.get("/health", (_req, res) => res.json({ ok: true, version }));
router.patch("/projects/:projectId/tickets/:ticketId", asyncHandler(async (req, res) => {
  const result = await projects.updateTicket(req.params.projectId, req.params.ticketId, req.body.patch, req.body.expectedRevision);
  events.publish({ type: "ticket.updated", projectId: req.params.projectId, revision: result.board.revision, ticket: result.ticket });
  res.json(result);
}));
```

- [ ] **Step 4: Write a WebSocket test that receives ordered revision events and reconnects**

```ts
const socket = await connectWs(url, projectId);
await moveTicket("ticket-1", "todo", 1);
expect(await nextEvent(socket)).toMatchObject({ type: "ticket.updated", revision: 2 });
```

- [ ] **Step 5: Run the WebSocket test and verify it fails**

Run: `npm test -- tests/integration/websocket.test.ts`

Expected: FAIL because no upgrade handler exists.

- [ ] **Step 6: Implement project-scoped WebSocket subscriptions and event replay**

```ts
wss.on("connection", (socket, request) => {
  const projectId = requireProjectQuery(request.url);
  const unsubscribe = events.subscribe(projectId, event => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify(event)));
  socket.on("close", unsubscribe);
});
```

- [ ] **Step 7: Add PID locking, loopback enforcement, and graceful shutdown**

```ts
if (host !== "127.0.0.1") throw new Error("Agents Runners v1 only permits 127.0.0.1");
const lock = await acquireDaemonLock(runtimeRoot);
process.once("SIGTERM", () => handle.close());
```

- [ ] **Step 8: Run focused tests, type-check, and commit**

Run: `npm test -- tests/integration/api.test.ts tests/integration/websocket.test.ts && npm run typecheck`

Expected: PASS.

```bash
git add src/runtime/runtime-store.ts src/server/project-registry.ts src/server/event-bus.ts src/server/websocket-hub.ts src/server/routes.ts src/server/app.ts src/server/daemon.ts tests/integration/api.test.ts tests/integration/websocket.test.ts
git commit -m "feat: add local realtime project daemon"
```

### Task 4: Redaction, tmux, Codex, worktree, and Git adapters

**Files:**
- Create: `src/security/redactor.ts`
- Create: `src/process/command-runner.ts`
- Create: `src/runners/tmux-service.ts`
- Create: `src/runners/codex-service.ts`
- Create: `src/runners/worktree-service.ts`
- Create: `src/git/integration-service.ts`
- Test: `tests/unit/redactor.test.ts`
- Test: `tests/unit/codex-events.test.ts`
- Test: `tests/integration/worktrees.test.ts`
- Test: `tests/integration/integration-git.test.ts`

**Interfaces:**
- Produces: `Redactor.redact(value): string`, `TmuxService`, `CodexService.runTurn`, `WorktreeService.ensureRunner`, `IntegrationService.integrate`.
- `CodexService.runTurn(input): AsyncIterable<CodexEvent>` returns a final `{ threadId, message, exitCode }` result.

- [ ] **Step 1: Write redaction and Codex JSONL parsing tests**

```ts
const redactor = new Redactor(["dev-secret-123"]);
expect(redactor.redact("token=dev-secret-123")).toBe("token=[REDACTED]");
expect(parseCodexEvent('{"type":"thread.started","thread_id":"abc"}')).toMatchObject({ type: "thread.started", threadId: "abc" });
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `npm test -- tests/unit/redactor.test.ts tests/unit/codex-events.test.ts`

Expected: FAIL because the adapters are missing.

- [ ] **Step 3: Implement literal/pattern redaction and tolerant JSONL normalization**

```ts
export function parseCodexEvent(line: string): CodexEvent {
  try { return normalizeCodexEvent(JSON.parse(line)); }
  catch { return { type: "process.output", text: line }; }
}
```

- [ ] **Step 4: Write temporary-repository tests for persistent role worktrees and serialized integration**

```ts
const runner = await worktrees.ensureRunner({ role: "developer", slot: 1, integrationBranch: "dev" });
expect(runner.branch).toBe("agents-runners/developer-01");
await integration.integrate({ candidateBranch: runner.branch, integrationBranch: "dev", verify: ["node -e \"process.exit(0)\""] });
expect(await git(repo, "rev-parse", "dev")).toBe(await git(repo, "rev-parse", "HEAD"));
```

- [ ] **Step 5: Run worktree and integration tests and verify they fail**

Run: `npm test -- tests/integration/worktrees.test.ts tests/integration/integration-git.test.ts`

Expected: FAIL because the Git services are missing.

- [ ] **Step 6: Implement persistent worktrees without automatic deletion**

```ts
await commands.run("git", ["worktree", "add", worktreePath, "-b", branch, integrationBranch], { cwd: repo });
await copyEnvironmentFiles(config.environments, repo, worktreePath);
return { id: `${role}-${pad(slot)}`, role, branch, worktreePath };
```

- [ ] **Step 7: Implement tmux panes and Codex turns using prompt files and JSONL event files**

```ts
const args = threadId
  ? ["exec", "resume", threadId, "-", "--json", "--dangerously-bypass-approvals-and-sandbox"]
  : ["exec", "-", "--json", "--dangerously-bypass-approvals-and-sandbox", "-C", worktreePath];
await tmux.runInPane(runner.tmuxTarget, { command: "codex", args, stdinFile: promptPath, eventFile, exitFile });
```

- [ ] **Step 8: Implement isolated integration verification before pushing dev**

```ts
await git.fetch(remote);
await integrator.fastForward(integrationBranch);
await integrator.merge(candidateBranch, ["--no-ff", "--no-edit"]);
await runVerification(integrator.path, commands);
await integrator.push(remote, integrationBranch);
```

- [ ] **Step 9: Run focused tests, type-check, and commit**

Run: `npm test -- tests/unit/redactor.test.ts tests/unit/codex-events.test.ts tests/integration/worktrees.test.ts tests/integration/integration-git.test.ts && npm run typecheck`

Expected: PASS.

```bash
git add src/security/redactor.ts src/process/command-runner.ts src/runners/tmux-service.ts src/runners/codex-service.ts src/runners/worktree-service.ts src/git/integration-service.ts tests/unit/redactor.test.ts tests/unit/codex-events.test.ts tests/integration/worktrees.test.ts tests/integration/integration-git.test.ts
git commit -m "feat: add persistent codex runner adapters"
```

### Task 5: Deterministic scheduler and autonomous fix loops

**Files:**
- Create: `src/orchestration/state-machine.ts`
- Create: `src/orchestration/runner-pool.ts`
- Create: `src/orchestration/scheduler.ts`
- Create: `src/orchestration/ticket-prompts.ts`
- Test: `tests/unit/state-machine.test.ts`
- Test: `tests/unit/scheduler.test.ts`
- Test: `tests/integration/autonomous-workflow.test.ts`

**Interfaces:**
- Consumes: stores, event bus, runner adapters, and integration service.
- Produces: `nextStage(status, outcome)`, `RunnerPool.claim(role, preferredId?)`, `Scheduler.reconcile(projectId)`.

- [ ] **Step 1: Write state-machine tests for every legal transition and retry outcome**

```ts
expect(nextStage("todo", { kind: "claimed" })).toBe("in_progress");
expect(nextStage("review", { kind: "passed" })).toBe("qa");
expect(nextStage("qa", { kind: "failed", attempts: 2, maxRetries: 3 })).toBe("in_progress");
expect(nextStage("qa", { kind: "failed", attempts: 3, maxRetries: 3 })).toBe("blocked");
expect(() => assertTransition("backlog", "done")).toThrow();
```

- [ ] **Step 2: Run state-machine tests and verify they fail**

Run: `npm test -- tests/unit/state-machine.test.ts`

Expected: FAIL because the state machine is missing.

- [ ] **Step 3: Implement exhaustive transitions and same-developer retry metadata**

```ts
export function nextStage(status: TicketStatus, outcome: StageOutcome): TicketStatus {
  if (outcome.kind === "failed") return outcome.attempts >= outcome.maxRetries ? "blocked" : "in_progress";
  return transitionTable[status][outcome.kind] ?? failTransition(status, outcome.kind);
}
```

- [ ] **Step 4: Write scheduler tests for dependencies, explicit assignment, pool caps, fairness, and cancellation**

```ts
await scheduler.reconcile(projectId);
expect(fakeCodex.started).toEqual([{ ticketId: "ready", runnerId: "developer-01" }]);
expect(fakeCodex.started).not.toContainEqual(expect.objectContaining({ ticketId: "depends-on-open" }));
```

- [ ] **Step 5: Run scheduler tests and verify they fail**

Run: `npm test -- tests/unit/scheduler.test.ts tests/integration/autonomous-workflow.test.ts`

Expected: FAIL because scheduler reconciliation is missing.

- [ ] **Step 6: Implement role queues, lazy persistent slots, and event-driven reconciliation**

```ts
for (const ticket of eligibleTickets(config)) {
  const role = roleForStatus(ticket.status);
  const runner = await pools.claim(role, ticket.assignedRunnerId);
  if (!runner) continue;
  void this.executeStage(project, ticket, runner).finally(() => this.reconcile(project.id));
}
```

- [ ] **Step 7: Implement developer, review, QA, retry, integration, and Blocked execution paths**

```ts
const outcome = await this.runStage(project, ticket, runner);
if (outcome.kind === "failed") {
  await this.resumeOriginalDeveloper(ticket, outcome.findings);
} else if (ticket.status === "qa") {
  await this.integrateAndComplete(project, ticket);
}
```

- [ ] **Step 8: Run focused tests, type-check, and commit**

Run: `npm test -- tests/unit/state-machine.test.ts tests/unit/scheduler.test.ts tests/integration/autonomous-workflow.test.ts && npm run typecheck`

Expected: PASS.

```bash
git add src/orchestration/state-machine.ts src/orchestration/runner-pool.ts src/orchestration/scheduler.ts src/orchestration/ticket-prompts.ts tests/unit/state-machine.test.ts tests/unit/scheduler.test.ts tests/integration/autonomous-workflow.test.ts
git commit -m "feat: automate complete ticket delivery workflow"
```

### Task 6: Donna shared thread and MCP tools

**Files:**
- Create: `src/donna/donna-service.ts`
- Create: `src/mcp/server.ts`
- Create: `src/mcp/tools.ts`
- Create: `src/cli/donna-client.ts`
- Modify: `src/server/routes.ts`
- Modify: `.mcp.json`
- Test: `tests/integration/donna.test.ts`
- Test: `tests/integration/mcp.test.ts`

**Interfaces:**
- Produces: `DonnaService.send(projectId, message): AsyncIterable<DonnaEvent>` and `createMcpServer(deps)`.

- [ ] **Step 1: Write a Donna test proving browser and terminal messages resume one thread**

```ts
await donna.send(projectId, "Plan auth").toArray();
await donna.send(projectId, "Continue").toArray();
expect(fakeCodex.calls[0].threadId).toBeUndefined();
expect(fakeCodex.calls[1].threadId).toBe("donna-thread-1");
```

- [ ] **Step 2: Run the Donna test and verify it fails**

Run: `npm test -- tests/integration/donna.test.ts`

Expected: FAIL because `DonnaService` is missing.

- [ ] **Step 3: Implement serialized project-specific Donna turns and WebSocket streaming**

```ts
return this.projectLocks.run(projectId, async () => {
  const threadId = await runtime.getDonnaThread(projectId);
  const result = await codex.runTurn({ threadId, prompt: buildDonnaPrompt(project, message), worktreePath: project.root });
  await runtime.setDonnaThread(projectId, result.threadId);
  return result;
});
```

- [ ] **Step 4: Write MCP tests for reads, revision-protected writes, progress, runners, and message_donna**

```ts
expect(await call("get_board", { projectRoot })).toMatchObject({ revision: 0, tickets: [] });
expect(await call("move_ticket", { projectRoot, ticketId, status: "todo", expectedRevision: 0 })).toMatchObject({ revision: 1 });
await expect(call("move_ticket", { projectRoot, ticketId, status: "qa", expectedRevision: 0 })).rejects.toThrow("revision");
```

- [ ] **Step 5: Run MCP tests and verify they fail**

Run: `npm test -- tests/integration/mcp.test.ts`

Expected: FAIL because MCP tools are missing.

- [ ] **Step 6: Implement all typed MCP tools from the spec and configure stdio launch**

```json
{
  "mcpServers": {
    "agents-runners": {
      "command": "node",
      "args": ["./dist/bin/mcp.mjs"],
      "cwd": "."
    }
  }
}
```

- [ ] **Step 7: Implement the interactive terminal Donna client over local HTTP/WebSocket**

```ts
for await (const line of readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "Donna> " })) {
  if (line.trim() === "/exit") break;
  await streamDonnaReply(projectId, line, chunk => process.stdout.write(chunk));
}
```

- [ ] **Step 8: Run focused tests, type-check, and commit**

Run: `npm test -- tests/integration/donna.test.ts tests/integration/mcp.test.ts && npm run typecheck`

Expected: PASS.

```bash
git add src/donna/donna-service.ts src/mcp/server.ts src/mcp/tools.ts src/cli/donna-client.ts src/server/routes.ts .mcp.json tests/integration/donna.test.ts tests/integration/mcp.test.ts
git commit -m "feat: connect donna chat and mcp"
```

### Task 7: Board-first white React interface

**Files:**
- Create: `index.html`
- Create: `vite.config.ts`
- Create: `web/src/main.tsx`
- Create: `web/src/app.tsx`
- Create: `web/src/styles.css`
- Create: `web/src/api/client.ts`
- Create: `web/src/api/socket.ts`
- Create: `web/src/state/use-project.ts`
- Create: `web/src/components/top-bar.tsx`
- Create: `web/src/components/board.tsx`
- Create: `web/src/components/column.tsx`
- Create: `web/src/components/ticket-card.tsx`
- Create: `web/src/components/ticket-drawer.tsx`
- Create: `web/src/components/donna-rail.tsx`
- Create: `web/src/components/runner-inspector.tsx`
- Create: `web/src/components/command-palette.tsx`
- Test: `web/src/components/board.test.tsx`
- Test: `web/src/components/donna-rail.test.tsx`
- Test: `web/src/components/runner-inspector.test.tsx`

**Interfaces:**
- Consumes: `/api/projects/:id`, ticket routes, Donna routes, and `/ws?projectId=`.
- Produces: project board UI and accessible browser interactions.

- [ ] **Step 1: Record the required gpt-taste design preflight in implementation commentary**

```text
seed=123; hero=Cinematic Center; font=Outfit
components=Inline Typography Images, Horizontal Accordions, Infinite Marquee
motion=Scroll Pinning, Card Stacking
```

- [ ] **Step 2: Write component tests for columns, optimistic drag, conflict rollback, Donna sending, and runner expansion**

```tsx
render(<Board project={projectWithTicket("backlog")} api={fakeApi} />);
await drag(screen.getByText("Build auth"), screen.getByRole("region", { name: "Todo" }));
expect(fakeApi.moveTicket).toHaveBeenCalledWith("ticket-1", "todo", 0);
```

- [ ] **Step 3: Run component tests and verify they fail**

Run: `npm test -- web/src/components/board.test.tsx web/src/components/donna-rail.test.tsx web/src/components/runner-inspector.test.tsx`

Expected: FAIL because the React application is missing.

- [ ] **Step 4: Implement API state, revision reconciliation, and WebSocket updates**

```ts
socket.onmessage = event => setProject(current => applyServerEvent(current, JSON.parse(event.data)));
async function moveTicket(ticketId: string, status: TicketStatus) {
  const snapshot = project;
  optimisticMove(ticketId, status);
  try { await api.moveTicket(project.id, ticketId, status, snapshot.board.revision); }
  catch { setProject(snapshot); await refresh(); }
}
```

- [ ] **Step 5: Implement the selected board-first layout and accessible interactions**

```tsx
<main className="app-shell">
  <TopBar />
  <section className="workspace">
    <Board />
    <DonnaRail />
  </section>
  <RunnerInspector />
  <TicketDrawer />
</main>
```

Use the selected gpt-taste component set without weakening dashboard usability: compact runner portraits appear inline beside the Agents Runners heading, the runner inspector is a keyboard-accessible horizontal accordion, and the top command bar contains a restrained infinite activity marquee that pauses on hover and focus. The 12-column desktop composition uses an 8-column board plus 4-column Donna rail, so every row fills all 12 tracks with `grid-auto-flow: dense` and no dead cells.

- [ ] **Step 6: Implement the pure-white Outfit design system and restrained GSAP motion**

```css
:root { --ink:#111; --muted:#6b6b6b; --line:#e7e7e3; --soft:#f7f7f5; --surface:#fff; }
.workspace { display:grid; grid-template-columns:minmax(0,1fr) 360px; min-height:0; }
.board { display:grid; grid-template-columns:repeat(7,minmax(260px,1fr)); grid-auto-flow:dense; }
@media (prefers-reduced-motion:reduce) { *,*::before,*::after { animation-duration:.01ms!important; scroll-behavior:auto!important; } }
```

```ts
gsap.registerPlugin(ScrollTrigger);
gsap.from("[data-ticket-card]", { y: 14, opacity: 0, stagger: 0.025, duration: 0.35, ease: "power2.out" });
gsap.to("[data-runner-card]", { y: index => index * -4, stagger: 0.03, duration: 0.3 });
ScrollTrigger.create({ trigger: "[data-activity-timeline]", start: "top top+=72", end: "bottom bottom", pin: "[data-activity-header]" });
```

- [ ] **Step 7: Run component tests, type-check, build, and commit**

Run: `npm test -- web/src/components/board.test.tsx web/src/components/donna-rail.test.tsx web/src/components/runner-inspector.test.tsx && npm run typecheck && npm run build:web`

Expected: PASS and Vite emits `dist/public/index.html`.

```bash
git add index.html vite.config.ts web/src/main.tsx web/src/app.tsx web/src/styles.css web/src/api/client.ts web/src/api/socket.ts web/src/state/use-project.ts web/src/components/top-bar.tsx web/src/components/board.tsx web/src/components/column.tsx web/src/components/ticket-card.tsx web/src/components/ticket-drawer.tsx web/src/components/donna-rail.tsx web/src/components/runner-inspector.tsx web/src/components/command-palette.tsx web/src/components/board.test.tsx web/src/components/donna-rail.test.tsx web/src/components/runner-inspector.test.tsx
git commit -m "feat: add white realtime runners dashboard"
```

### Task 8: Browser workflow, diagnostics, and lifecycle commands

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/board-workflow.spec.ts`
- Create: `tests/e2e/config-error.spec.ts`
- Create: `src/doctor/doctor.ts`
- Create: `src/cli/daemon-client.ts`
- Modify: `src/cli/index.ts`
- Modify: `src/server/app.ts`
- Test: `tests/unit/doctor.test.ts`

**Interfaces:**
- Produces CLI commands `start`, `stop`, `status`, `open`, `donna`, and `doctor`.

- [ ] **Step 1: Write doctor tests for Node, Git, tmux, Codex, authentication, dev branch, and loopback server**

```ts
const report = await runDoctor({ commands: fakeCommands({ tmux: false }), root: repo });
expect(report.checks).toContainEqual(expect.objectContaining({ id: "tmux", status: "error" }));
expect(report.ok).toBe(false);
```

- [ ] **Step 2: Run doctor tests and verify they fail**

Run: `npm test -- tests/unit/doctor.test.ts`

Expected: FAIL because doctor checks are missing.

- [ ] **Step 3: Implement lifecycle and diagnostic commands without destructive cleanup**

```ts
program.command("start").action(() => daemon.ensureRunning());
program.command("stop").action(() => daemon.stop());
program.command("status").action(() => printJson(daemon.status()));
program.command("open").action(() => openProjectUrl(process.cwd()));
program.command("doctor").action(() => printDoctor(runDoctor(process.cwd())));
```

- [ ] **Step 4: Write Playwright tests for drag-to-Todo, auto-progress, Donna chat, failure retry, and config errors**

```ts
await page.getByText("Build auth").dragTo(page.getByRole("region", { name: "Todo" }));
await expect(page.getByText("Developer 01")).toContainText("Working");
await fakeRunner.complete("developer", "passed");
await expect(page.getByText("Build auth")).toBeVisible({ timeout: 10_000 });
```

- [ ] **Step 5: Run browser tests and verify the first missing-flow failure**

Run: `npm run build && npm run test:e2e`

Expected: FAIL until the test harness and static SPA fallback are wired.

- [ ] **Step 6: Add a fake-runner test mode, static asset serving, SPA fallback, and deterministic E2E fixtures**

```ts
app.use(express.static(publicDir));
app.get("/{*splat}", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));
if (process.env.AGENTS_RUNNERS_FAKE_RUNNER === "1") dependencies.codex = createFakeCodexController();
```

- [ ] **Step 7: Run doctor, API, and browser tests, then commit**

Run: `npm test -- tests/unit/doctor.test.ts && npm run build && npm run test:e2e`

Expected: PASS.

```bash
git add playwright.config.ts tests/e2e/board-workflow.spec.ts tests/e2e/config-error.spec.ts src/doctor/doctor.ts src/cli/daemon-client.ts src/cli/index.ts src/server/app.ts tests/unit/doctor.test.ts
git commit -m "feat: add diagnostics and browser workflow"
```

### Task 9: Plugin skill, manifests, documentation, and distributable build

**Files:**
- Create: `skills/agents-runners/SKILL.md`
- Create: `README.md`
- Create: `docs/configuration.md`
- Create: `docs/architecture.md`
- Modify: `.codex-plugin/plugin.json`
- Modify: `.mcp.json`
- Modify: `package.json`
- Test: `tests/integration/distribution.test.ts`

**Interfaces:**
- Produces an installable personal plugin and agent instructions that route board work through MCP and Donna.

- [ ] **Step 1: Read the local skill-creator and Superpowers writing-skills instructions before authoring the plugin skill**

Run: `sed -n '1,320p' /Users/abhijayrajvansh/.codex/skills/.system/skill-creator/SKILL.md`

Run: `sed -n '1,360p' /Users/abhijayrajvansh/.codex/plugins/cache/openai-curated-remote/superpowers/6.3.0/skills/writing-skills/SKILL.md`

Expected: both instruction files are read completely before editing `SKILL.md`.

- [ ] **Step 2: Write a distribution test for required assets and runnable bundled entries**

```ts
expect(await exists("dist/bin/cli.mjs")).toBe(true);
expect(await exists("dist/bin/mcp.mjs")).toBe(true);
expect(await exists("dist/public/index.html")).toBe(true);
expect(JSON.parse(await read(".codex-plugin/plugin.json"))).toMatchObject({ name: "agents-runners", mcpServers: "./.mcp.json" });
```

- [ ] **Step 3: Run the distribution test and verify it fails**

Run: `npm test -- tests/integration/distribution.test.ts`

Expected: FAIL until the bundled files and finalized manifest exist.

- [ ] **Step 4: Write the Agents Runners skill with explicit Donna and lifecycle instructions**

```markdown
---
name: agents-runners
description: Operate an initialized Agents Runners project, including Donna, its Kanban board, persistent role pools, and autonomous ticket delivery.
---

# Agents Runners

When `.agents-runners/config.json` exists, begin by calling `get_project` and `get_board`. Treat Backlog as inactive. Use revision-protected MCP writes for every board change. Send orchestration requests to Donna instead of creating unmanaged background Codex processes.
```

- [ ] **Step 5: Finalize manifest metadata, MCP launch path, README, configuration, and architecture docs**

```json
{
  "name": "agents-runners",
  "version": "0.1.0",
  "description": "Local autonomous Kanban orchestration for persistent Codex runners",
  "author": { "name": "Abhijay Rajvansh" },
  "skills": "./skills/",
  "mcpServers": "./.mcp.json",
  "interface": {
    "displayName": "Agents Runners",
    "shortDescription": "Donna coordinates persistent Codex delivery teams.",
    "longDescription": "Run a local bidirectional Kanban board with Donna, persistent developer, reviewer, and QA pools, isolated worktrees, and autonomous delivery into dev.",
    "developerName": "Abhijay Rajvansh",
    "category": "Productivity",
    "capabilities": ["Interactive", "Write"],
    "defaultPrompt": ["Open Agents Runners for this project.", "Ask Donna to plan the current backlog.", "Show active runners and blockers."]
  }
}
```

- [ ] **Step 6: Build, run distribution and skill validators, and commit**

Run: `npm run build && npm test -- tests/integration/distribution.test.ts`

Run: `python3 /Users/abhijayrajvansh/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/agents-runners`

Run: `python3 /Users/abhijayrajvansh/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py .`

Expected: all commands PASS in an isolated Python environment containing PyYAML.

```bash
git add skills/agents-runners/SKILL.md README.md docs/configuration.md docs/architecture.md .codex-plugin/plugin.json .mcp.json package.json tests/integration/distribution.test.ts
git commit -m "docs: package complete codex runners plugin"
```

### Task 10: Full release gate, local installation, and live temporary-project smoke test

**Files:**
- Create: `tests/fixtures/smoke-project/README.md`
- Modify: `README.md`
- Modify: `.codex-plugin/plugin.json` through the cachebuster helper

**Interfaces:**
- Consumes the complete built plugin.
- Produces an installed `agents-runners@personal` plugin and verified temporary-project workflow.

- [ ] **Step 1: Run the complete deterministic release gate**

Run: `npm run gate`

Expected: type checking, all Vitest suites, node/web builds, and Playwright suites PASS.

- [ ] **Step 2: Validate the plugin and marketplace entry in an isolated Python environment**

Run: `uv run --with pyyaml python /Users/abhijayrajvansh/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py /Users/abhijayrajvansh/plugins/agents-runners`

Expected: plugin validation PASS.

- [ ] **Step 3: Update the local cachebuster and reinstall from the personal marketplace**

Run: `python3 /Users/abhijayrajvansh/.codex/skills/.system/plugin-creator/scripts/update_plugin_cachebuster.py /Users/abhijayrajvansh/plugins/agents-runners`

Run: `codex plugin add agents-runners@personal`

Expected: Codex reports the plugin installed successfully.

- [ ] **Step 4: Initialize a temporary Git project with fake development credentials**

Run: `mktemp -d`, initialize `dev`, write a harmless sample application, create `.env.development` containing only fake values, and run `node dist/bin/cli.mjs init --root <temporary-project>`.

Expected: config, managed AGENTS.md block, hooks, and gitignore entries are created without printing environment values.

- [ ] **Step 5: Start the daemon and verify the complete fake-runner workflow**

Run: `AGENTS_RUNNERS_FAKE_RUNNER=1 node dist/bin/cli.mjs start`

Create a ticket, move it to Todo, and observe developer, reviewer, QA, integration, and Done events through API/WebSocket.

Expected: the ticket reaches Done, `dev` contains the integration commit, and all three logical runners report Idle with persistent worktrees.

- [ ] **Step 6: Verify the white UI manually at its loopback URL**

Check the board-first layout, drag-and-drop, Donna rail, runner inspector, responsive behavior, keyboard focus, motion reduction, and absence of secret values.

Expected: no clipped layout, horizontal page overflow, unreadable contrast, stale state, or secret leakage.

- [ ] **Step 7: Run final status checks, commit the release evidence, and push if a remote exists**

Run: `git status --short`, `git log --oneline -10`, and `git remote -v`.

```bash
git add README.md .codex-plugin/plugin.json tests/fixtures/smoke-project/README.md
git commit -m "chore: verify codex runners release workflow"
git push origin main
```

Expected: clean working tree and successful push. If no remote exists, retain all local commits and report the exact missing remote instead of inventing one.
