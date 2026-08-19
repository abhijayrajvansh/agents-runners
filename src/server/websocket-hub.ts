import type { Server } from "node:http";

import { WebSocket, WebSocketServer } from "ws";

import type { EventBus } from "./event-bus.js";
import { hasPublicAccess, isPublicRequest } from "./public-access.js";

export function attachWebSocketServer(server: Server, events: EventBus, publicAccessToken?: string): WebSocketServer {
  const sockets = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (
      url.pathname !== "/ws" ||
      !url.searchParams.get("projectId") ||
      (publicAccessToken && isPublicRequest(request) && !hasPublicAccess(request, publicAccessToken))
    ) {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, websocket => {
      sockets.emit("connection", websocket, request);
    });
  });

  sockets.on("connection", (socket, request) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const projectId = url.searchParams.get("projectId");
    if (!projectId) {
      socket.close(1008, "projectId is required");
      return;
    }
    const since = Number.parseInt(url.searchParams.get("since") ?? "0", 10);
    for (const event of events.replay(projectId, Number.isFinite(since) ? since : 0)) {
      socket.send(JSON.stringify(event));
    }
    const unsubscribe = events.subscribe(projectId, event => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
    });
    socket.once("close", unsubscribe);
  });

  return sockets;
}
