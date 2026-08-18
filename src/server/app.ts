import express, { type ErrorRequestHandler, type Express } from "express";
import path from "node:path";
import { ZodError } from "zod";

import type { DonnaService, DonnaMessageSource } from "../donna/donna-service.js";
import { MCP_TOOL_NAMES, type McpToolName, type McpTools } from "../mcp/tools.js";
import type { AutomationManager } from "../orchestration/automation-manager.js";
import { StoreError } from "../storage/atomic-json-store.js";
import type { EventBus } from "./event-bus.js";
import { ProjectRegistryError, type ProjectRegistry } from "./project-registry.js";

export type AppDependencies = {
  registry: ProjectRegistry;
  events: EventBus;
  version: string;
  onProjectRegistered?: (root: string) => Promise<void> | void;
  donna?: DonnaService;
  mcpTools?: McpTools;
  automation?: Pick<AutomationManager, "list" | "get">;
  publicDirectory?: string;
};

export function createApp(dependencies: AppDependencies): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_request, response) => {
    response.json({ ok: true, version: dependencies.version });
  });

  app.post("/api/projects/register", asyncRoute(async (request, response) => {
    const body = request.body as { root?: unknown };
    if (typeof body.root !== "string" || body.root.length === 0) {
      throw new ZodError([]);
    }
    const config = await dependencies.registry.register(body.root);
    await dependencies.onProjectRegistered?.(body.root);
    response.json({ project: config.project, board: config.board });
  }));

  app.get("/api/projects", (_request, response) => {
    response.json({ projects: dependencies.registry.list().map(config => config.project) });
  });

  app.get("/api/projects/:projectId", asyncRoute(async (request, response) => {
    const config = dependencies.registry.get(requiredParam(request.params.projectId));
    response.json(config);
  }));

  app.get("/api/projects/:projectId/board", asyncRoute(async (request, response) => {
    response.json(dependencies.registry.getBoard(requiredParam(request.params.projectId)));
  }));

  app.post("/api/projects/:projectId/tickets", asyncRoute(async (request, response) => {
    const body = request.body as { expectedRevision?: unknown; ticket?: unknown };
    const result = await dependencies.registry.createTicket(
      requiredParam(request.params.projectId),
      body.ticket,
      requiredRevision(body.expectedRevision)
    );
    response.status(201).json(result);
  }));

  app.patch("/api/projects/:projectId/tickets/:ticketId", asyncRoute(async (request, response) => {
    const body = request.body as { expectedRevision?: unknown; patch?: unknown };
    const result = await dependencies.registry.updateTicket(
      requiredParam(request.params.projectId),
      requiredParam(request.params.ticketId),
      body.patch,
      requiredRevision(body.expectedRevision)
    );
    response.json(result);
  }));

  app.get("/api/projects/:projectId/runners", asyncRoute(async (request, response) => {
    const projectId = requiredParam(request.params.projectId);
    dependencies.registry.get(projectId);
    response.json({ runners: dependencies.automation?.list(projectId) ?? [] });
  }));

  app.get("/api/projects/:projectId/runners/:runnerId", asyncRoute(async (request, response) => {
    const projectId = requiredParam(request.params.projectId);
    dependencies.registry.get(projectId);
    const runnerId = requiredParam(request.params.runnerId);
    const runner = dependencies.automation?.get(projectId, runnerId);
    if (!runner) {
      response.status(404).json({ error: { code: "RUNNER_NOT_FOUND", message: `Runner ${runnerId} was not found` } });
      return;
    }
    response.json(runner);
  }));

  app.post("/api/projects/:projectId/donna", asyncRoute(async (request, response) => {
    if (!dependencies.donna) throw new Error("Donna is unavailable");
    const body = request.body as { message?: unknown; source?: unknown };
    if (typeof body.message !== "string" || body.message.trim().length === 0) throw new ZodError([]);
    const source: DonnaMessageSource = body.source === "terminal" || body.source === "mcp" ? body.source : "browser";
    const donnaEvents = [];
    let message = "";
    for await (const event of dependencies.donna.send(requiredParam(request.params.projectId), body.message, source)) {
      donnaEvents.push(event);
      if (event.type === "completed") message = event.message;
      if (event.type === "error") throw new Error(event.message);
    }
    response.json({ message, events: donnaEvents });
  }));

  app.post("/api/mcp/:toolName", asyncRoute(async (request, response) => {
    if (!dependencies.mcpTools) throw new Error("MCP tools are unavailable");
    const toolName = requiredParam(request.params.toolName);
    if (!MCP_TOOL_NAMES.includes(toolName as McpToolName)) throw new ZodError([]);
    response.json(await dependencies.mcpTools.call(toolName as McpToolName, request.body));
  }));

  if (dependencies.publicDirectory) {
    app.use(express.static(dependencies.publicDirectory));
    app.get("/{*splat}", (_request, response) => {
      response.sendFile(path.join(dependencies.publicDirectory as string, "index.html"));
    });
  }

  const errors: ErrorRequestHandler = (error, _request, response, _next) => {
    if (error instanceof ZodError) {
      response.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Request validation failed", issues: error.issues } });
      return;
    }
    if (error instanceof StoreError && error.code === "REVISION_CONFLICT") {
      response.status(409).json({ error: { code: error.code, message: error.message } });
      return;
    }
    if (error instanceof StoreError) {
      response.status(400).json({ error: { code: error.code, message: error.message } });
      return;
    }
    if (error instanceof ProjectRegistryError) {
      response.status(404).json({ error: { code: error.code, message: error.message } });
      return;
    }
    response.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Unexpected server error" } });
  };
  app.use(errors);
  return app;
}

function requiredRevision(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new ZodError([]);
  return value as number;
}

function requiredParam(value: string | string[] | undefined): string {
  if (typeof value !== "string" || value.length === 0) throw new ZodError([]);
  return value;
}

function asyncRoute(
  handler: (request: express.Request, response: express.Response) => Promise<void>
): express.RequestHandler {
  return (request, response, next) => {
    void handler(request, response).catch(next);
  };
}
