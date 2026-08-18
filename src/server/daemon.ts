import { createServer, type Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DonnaService } from "../donna/donna-service.js";
import { McpTools } from "../mcp/tools.js";
import { AutomationManager } from "../orchestration/automation-manager.js";
import { createApp } from "./app.js";
import { EventBus } from "./event-bus.js";
import { ProjectRegistry } from "./project-registry.js";
import { attachWebSocketServer } from "./websocket-hub.js";
import { RuntimeStore } from "../runtime/runtime-store.js";

export type StartDaemonOptions = {
  host: string;
  port: number;
  runtimeRoot: string;
  version: string;
  publicDirectory?: string;
};

export type DaemonHandle = {
  host: string;
  port: number;
  url: string;
  close(): Promise<void>;
};

export async function startDaemon(options: StartDaemonOptions): Promise<DaemonHandle> {
  if (options.host !== "127.0.0.1") {
    throw new Error("Codex Runners v1 only permits the 127.0.0.1 loopback host");
  }
  const runtime = new RuntimeStore(options.runtimeRoot);
  const releaseLock = await runtime.acquireLock();
  const events = new EventBus();
  const registry = new ProjectRegistry(events);
  for (const root of await runtime.loadProjects()) {
    await registry.register(root).catch(() => undefined);
  }
  const automation = new AutomationManager(registry, events);
  for (const project of registry.list()) automation.register(project.project.id);
  const donna = new DonnaService({
    registry,
    events,
    codex: automation.codex,
    tmux: automation.tmux,
    runtimeFor: project => automation.runtimeFor(project)
  });
  const mcpTools = new McpTools({ registry, events, runners: automation, donna });
  const app = createApp({
    registry,
    events,
    version: options.version,
    automation,
    donna,
    mcpTools,
    publicDirectory: options.publicDirectory ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/public"),
    onProjectRegistered: async root => {
      await runtime.rememberProject(root);
      const project = await registry.register(root);
      automation.register(project.project.id);
    }
  });
  const server = createServer(app);
  const sockets = attachWebSocketServer(server, events);

  try {
    await listen(server, options.host, options.port);
  } catch (error) {
    registry.close();
    automation.close();
    sockets.close();
    await releaseLock();
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    registry.close();
    automation.close();
    sockets.close();
    await releaseLock();
    throw new Error("Codex Runners daemon did not bind a TCP address");
  }
  await runtime.writeMetadata({
    pid: process.pid,
    host: options.host,
    port: address.port,
    version: options.version,
    startedAt: new Date().toISOString()
  });
  let closed = false;

  return {
    host: options.host,
    port: address.port,
    url: `http://${options.host}:${address.port}`,
    async close() {
      if (closed) return;
      closed = true;
      for (const client of sockets.clients) client.terminate();
      sockets.close();
      await closeServer(server);
      registry.close();
      automation.close();
      await releaseLock();
    }
  };
}

function listen(server: Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(error => error ? reject(error) : resolve());
  });
}
