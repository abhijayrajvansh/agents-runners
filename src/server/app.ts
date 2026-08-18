import express, { type ErrorRequestHandler, type Express } from "express";
import { ZodError } from "zod";

import { StoreError } from "../storage/atomic-json-store.js";
import type { EventBus } from "./event-bus.js";
import { ProjectRegistryError, type ProjectRegistry } from "./project-registry.js";

export type AppDependencies = {
  registry: ProjectRegistry;
  events: EventBus;
  version: string;
  onProjectRegistered?: (root: string) => Promise<void> | void;
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
