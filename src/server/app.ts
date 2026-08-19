import express, { type ErrorRequestHandler, type Express } from "express";
import { ZodError } from "zod";

import { ticketSearchScore } from "../domain/ticket-search.js";
import type { DonnaService, DonnaMessageSource } from "../donna/donna-service.js";
import { MCP_TOOL_NAMES, type McpToolName, type McpTools } from "../mcp/tools.js";
import type { AutomationManager } from "../orchestration/automation-manager.js";
import { listAvailableCodexModels } from "../runners/codex-models.js";
import { StoreError } from "../storage/atomic-json-store.js";
import type { EventBus } from "./event-bus.js";
import { ProjectRegistryError, type ProjectRegistry } from "./project-registry.js";
import { hasPublicAccess, isPublicRequest, PUBLIC_ACCESS_COOKIE } from "./public-access.js";

export type AppDependencies = {
  registry: ProjectRegistry;
  events: EventBus;
  version: string;
  onProjectRegistered?: (root: string) => Promise<void> | void;
  onProjectUnregistered?: (projectId: string, root: string) => Promise<void> | void;
  donna?: DonnaService;
  mcpTools?: McpTools;
  automation?: Pick<AutomationManager, "list" | "get"> & Partial<Pick<AutomationManager, "terminals" | "deliveries" | "mergeTicket" | "abortTicket">>;
  publicDirectory?: string;
  publicAccessToken?: string;
};

export function createApp(dependencies: AppDependencies): Express {
  const app = express();
  app.disable("x-powered-by");
  if (dependencies.publicAccessToken) {
    app.use((request, response, next) => {
      if (!isPublicRequest(request) || hasPublicAccess(request, dependencies.publicAccessToken!)) {
        if (isPublicRequest(request) && request.query.access === dependencies.publicAccessToken) {
          response.setHeader(
            "set-cookie",
            `${PUBLIC_ACCESS_COOKIE}=${encodeURIComponent(dependencies.publicAccessToken!)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`
          );
        }
        next();
        return;
      }
      response.status(401).send("This Codex Runners link requires its private access token.");
    });
  }
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

  app.get("/api/models", asyncRoute(async (_request, response) => {
    response.json({ models: await listAvailableCodexModels() });
  }));

  app.get("/api/search/tickets", (request, response) => {
    const query = typeof request.query.q === "string" ? request.query.q.trim().toLowerCase() : "";
    if (!query) {
      response.json({ results: [] });
      return;
    }
    const results = dependencies.registry.list().flatMap(config => config.board.tickets
      .map(ticket => ({
        projectId: config.project.id,
        projectName: config.project.name,
        ticket,
        score: ticketSearchScore(query, config.project.name, ticket)
      }))
      .filter(result => result.score >= 0))
      .sort((left, right) => right.score - left.score || right.ticket.updatedAt.localeCompare(left.ticket.updatedAt))
      .slice(0, 50);
    response.json({ results });
  });

  app.get("/api/projects/:projectId", asyncRoute(async (request, response) => {
    const config = dependencies.registry.get(requiredParam(request.params.projectId));
    response.json(config);
  }));

  app.delete("/api/projects/:projectId", asyncRoute(async (request, response) => {
    const requestedProject = requiredParam(request.params.projectId);
    const config = dependencies.registry.list().find(candidate => (
      candidate.project.id === requestedProject || candidate.project.name === requestedProject
    ));
    if (!config) throw new ProjectRegistryError("PROJECT_NOT_FOUND", `Project ${requestedProject} was not found`);
    const projectId = config.project.id;
    await dependencies.onProjectUnregistered?.(projectId, config.project.repositoryRoot);
    response.json({ stopped: true, project: config.project });
  }));

  app.get("/api/projects/:projectId/board", asyncRoute(async (request, response) => {
    response.json(dependencies.registry.getBoard(requiredParam(request.params.projectId)));
  }));

  app.patch("/api/projects/:projectId/pools/:role", asyncRoute(async (request, response) => {
    const body = request.body as { maximum?: unknown; expectedRevision?: unknown };
    response.json(await dependencies.registry.updatePoolMaximum(
      requiredParam(request.params.projectId),
      requiredParam(request.params.role),
      body.maximum,
      requiredRevision(body.expectedRevision)
    ));
  }));

  app.patch("/api/projects/:projectId/donna/model", asyncRoute(async (request, response) => {
    const body = request.body as { model?: unknown; expectedRevision?: unknown };
    response.json(await dependencies.registry.updateDonnaModel(
      requiredParam(request.params.projectId),
      body.model,
      requiredRevision(body.expectedRevision)
    ));
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
    const projectId = requiredParam(request.params.projectId);
    const ticketId = requiredParam(request.params.ticketId);
    const current = dependencies.registry.getBoard(projectId).tickets.find(ticket => ticket.id === ticketId);
    if (current && ["todo", "in_progress", "review", "qa"].includes(current.status)) {
      response.status(423).json({ error: { code: "TICKET_LOCKED", message: "Active issues are read-only. Abort the issue before editing it." } });
      return;
    }
    const result = await dependencies.registry.updateTicket(
      projectId,
      ticketId,
      body.patch,
      requiredRevision(body.expectedRevision)
    );
    response.json(result);
  }));

  app.post("/api/projects/:projectId/tickets/:ticketId/abort", asyncRoute(async (request, response) => {
    if (!dependencies.automation?.abortTicket) throw new Error("Abort service is unavailable");
    const body = request.body as { expectedRevision?: unknown };
    response.json(await dependencies.automation.abortTicket(
      requiredParam(request.params.projectId),
      requiredParam(request.params.ticketId),
      requiredRevision(body.expectedRevision)
    ));
  }));

  app.get("/api/projects/:projectId/runners", asyncRoute(async (request, response) => {
    const projectId = requiredParam(request.params.projectId);
    dependencies.registry.get(projectId);
    response.json({ runners: dependencies.automation?.list(projectId) ?? [] });
  }));

  app.get("/api/projects/:projectId/deliveries", asyncRoute(async (request, response) => {
    const projectId = requiredParam(request.params.projectId);
    dependencies.registry.get(projectId);
    response.json({ deliveries: dependencies.automation?.deliveries?.(projectId) ?? {} });
  }));

  app.post("/api/projects/:projectId/tickets/:ticketId/merge", asyncRoute(async (request, response) => {
    if (!dependencies.automation?.mergeTicket) throw new Error("Merge service is unavailable");
    const projectId = requiredParam(request.params.projectId);
    const ticketId = requiredParam(request.params.ticketId);
    response.json({ delivery: await dependencies.automation.mergeTicket(projectId, ticketId) });
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

  app.get("/api/projects/:projectId/terminals", asyncRoute(async (request, response) => {
    const projectId = requiredParam(request.params.projectId);
    dependencies.registry.get(projectId);
    response.json({ terminals: await dependencies.automation?.terminals?.(projectId) ?? [] });
  }));

  app.post("/api/projects/:projectId/donna", asyncRoute(async (request, response) => {
    if (!dependencies.donna) throw new Error("Donna is unavailable");
    const body = request.body as { message?: unknown; source?: unknown; sessionId?: unknown };
    if (typeof body.message !== "string" || body.message.trim().length === 0) throw new ZodError([]);
    const source: DonnaMessageSource = body.source === "terminal" || body.source === "mcp" ? body.source : "browser";
    const sessionId = typeof body.sessionId === "string" && body.sessionId.trim().length > 0 ? body.sessionId : "default";
    const stream = request.accepts(["application/x-ndjson", "json"]) === "application/x-ndjson";
    if (stream) {
      response.status(200);
      response.setHeader("content-type", "application/x-ndjson; charset=utf-8");
      response.setHeader("cache-control", "no-cache, no-transform");
      response.setHeader("x-accel-buffering", "no");
      response.flushHeaders();
      for await (const event of dependencies.donna.send(requiredParam(request.params.projectId), body.message, source, sessionId)) {
        response.write(`${JSON.stringify(event)}\n`);
        if (event.type === "error") break;
      }
      response.end();
      return;
    }
    const donnaEvents = [];
    let message = "";
    for await (const event of dependencies.donna.send(requiredParam(request.params.projectId), body.message, source, sessionId)) {
      donnaEvents.push(event);
      if (event.type === "completed") message = event.message;
      if (event.type === "error") throw new Error(event.message);
    }
    response.json({ message, events: donnaEvents });
  }));

  app.get("/api/projects/:projectId/donna", asyncRoute(async (request, response) => {
    if (!dependencies.donna) throw new Error("Donna is unavailable");
    const sessionId = typeof request.query.sessionId === "string" && request.query.sessionId.trim().length > 0
      ? request.query.sessionId
      : "default";
    response.json({ messages: dependencies.donna.history(requiredParam(request.params.projectId), sessionId) });
  }));

  app.get("/api/projects/:projectId/donna/sessions", asyncRoute(async (request, response) => {
    if (!dependencies.donna) throw new Error("Donna is unavailable");
    response.json({ sessions: dependencies.donna.sessions(requiredParam(request.params.projectId)) });
  }));

  app.post("/api/projects/:projectId/donna/sessions", asyncRoute(async (request, response) => {
    if (!dependencies.donna) throw new Error("Donna is unavailable");
    const body = request.body as { title?: unknown };
    const title = typeof body.title === "string" ? body.title : undefined;
    response.status(201).json({ session: dependencies.donna.createSession(requiredParam(request.params.projectId), title) });
  }));

  app.post("/api/projects/:projectId/donna/sessions/:sessionId/reset", asyncRoute(async (request, response) => {
    if (!dependencies.donna) throw new Error("Donna is unavailable");
    dependencies.donna.resetSession(requiredParam(request.params.projectId), requiredParam(request.params.sessionId));
    response.json({ reset: true });
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
      response.sendFile("index.html", { root: dependencies.publicDirectory });
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
