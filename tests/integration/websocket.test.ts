import { createServer } from "node:http";

import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { createApp } from "../../src/server/app.js";
import { EventBus } from "../../src/server/event-bus.js";
import { ProjectRegistry } from "../../src/server/project-registry.js";
import { attachWebSocketServer } from "../../src/server/websocket-hub.js";
import { createInitializedProject } from "../helpers/initialized-project.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()));
});

describe("project WebSocket events", () => {
  it("streams ordered project events and replays events after a sequence", async () => {
    const project = await createInitializedProject();
    cleanups.push(project.cleanup);
    const events = new EventBus(10);
    const registry = new ProjectRegistry(events);
    const registered = await registry.register(project.root);
    const server = createServer(createApp({ registry, events, version: "0.1.0" }));
    const sockets = attachWebSocketServer(server, events);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    cleanups.push(async () => {
      sockets.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server did not bind a TCP port");

    const first = new WebSocket(`ws://127.0.0.1:${address.port}/ws?projectId=${registered.project.id}`);
    await onceOpen(first);
    events.publish({
      type: "ticket.updated",
      projectId: registered.project.id,
      revision: 2,
      payload: { ticketId: "ticket-1", status: "todo" }
    });
    const streamed = await onceMessage(first);
    first.close();

    expect(streamed).toMatchObject({ type: "ticket.updated", sequence: 1, revision: 2 });

    events.publish({
      type: "runner.updated",
      projectId: registered.project.id,
      revision: 2,
      payload: { runnerId: "developer-01", status: "working" }
    });
    const replay = new WebSocket(`ws://127.0.0.1:${address.port}/ws?projectId=${registered.project.id}&since=1`);
    const replayed = await onceMessage(replay);
    replay.close();

    expect(replayed).toMatchObject({ type: "runner.updated", sequence: 2 });
  });
});

function onceOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

function onceMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    socket.once("message", data => resolve(JSON.parse(data.toString()) as Record<string, unknown>));
    socket.once("error", reject);
  });
}
