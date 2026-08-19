import { createServer } from "node:http";
import path from "node:path";
import { writeFile } from "node:fs/promises";

import type { DonnaService } from "../../src/donna/donna-service.js";
import type { AutomationManager } from "../../src/orchestration/automation-manager.js";
import type { RunnerRecord } from "../../src/orchestration/runner-pool.js";
import { projectConfigPath } from "../../src/platform/paths.js";
import { createApp } from "../../src/server/app.js";
import { EventBus } from "../../src/server/event-bus.js";
import { ProjectRegistry } from "../../src/server/project-registry.js";
import { attachWebSocketServer } from "../../src/server/websocket-hub.js";
import { createInitializedProject } from "../helpers/initialized-project.js";

const initialized = await createInitializedProject();
const events = new EventBus();
const registry = new ProjectRegistry(events);
const project = await registry.register(initialized.root);
const runners: RunnerRecord[] = (["developer", "reviewer", "qa"] as const).map((role, index) => ({
  id: `${role}-01`,
  role,
  slot: 1,
  status: "idle",
  worktreePath: path.join(initialized.root, ".worktrees", "codex-runners", `${role}-01`),
  branch: `codex-runners/${role}-01`,
  tmuxTarget: `${project.project.id}:${role}-01`
}));
const automation = {
  list: () => runners,
  get: (_projectId: string, runnerId: string) => runners.find(runner => runner.id === runnerId)
} as Pick<AutomationManager, "list" | "get">;
const donna = {
  async *send(projectId: string) {
    yield { type: "message" as const, projectId, text: "I’ll coordinate that with the runner team." };
    yield { type: "completed" as const, projectId, message: "I’ll coordinate that with the runner team." };
  },
  history: () => []
} as unknown as DonnaService;
const processing = new Set<string>();
events.subscribe(project.project.id, event => {
  if (event.type !== "ticket.updated") return;
  const ticket = event.payload.ticket as { id?: string; status?: string };
  if (ticket.status !== "todo" || !ticket.id || processing.has(ticket.id)) return;
  processing.add(ticket.id);
  void deliver(ticket.id).finally(() => processing.delete(ticket.id as string));
});

const app = createApp({
  registry,
  events,
  version: "e2e",
  automation,
  donna,
  publicDirectory: path.resolve("dist/public")
});
app.post("/__test/config-error", async (_request, response) => {
  await writeFile(projectConfigPath(initialized.root), "{ invalid", "utf8");
  response.json({ ok: true });
});
const server = createServer(app);
const sockets = attachWebSocketServer(server, events);
server.listen(4788, "127.0.0.1");

async function deliver(ticketId: string): Promise<void> {
  for (const [status, role] of [
    ["in_progress", "developer"],
    ["review", "reviewer"],
    ["qa", "qa"],
    ["done", null]
  ] as const) {
    for (const runner of runners) {
      runner.status = runner.role === role ? "working" : "idle";
      if (runner.role === role) runner.ticketId = ticketId;
      else delete runner.ticketId;
    }
    events.publish({
      type: "runner.updated",
      projectId: project.project.id,
      revision: registry.getBoard(project.project.id).revision,
      payload: { role, status: role ? "working" : "idle", ticketId }
    });
    await new Promise(resolve => setTimeout(resolve, 120));
    const board = registry.getBoard(project.project.id);
    await registry.updateTicket(project.project.id, ticketId, { status }, board.revision);
  }
}

async function close() {
  for (const client of sockets.clients) client.terminate();
  sockets.close();
  registry.close();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await initialized.cleanup();
  process.exit(0);
}
process.once("SIGTERM", () => void close());
process.once("SIGINT", () => void close());
