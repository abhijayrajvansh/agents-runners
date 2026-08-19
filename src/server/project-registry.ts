import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  ProjectConfigSchema,
  RoleNameSchema,
  TicketSchema,
  type ProjectConfig,
  type RoleName,
  type Ticket
} from "../domain/schema.js";
import { projectConfigPath } from "../platform/paths.js";
import { AtomicJsonStore } from "../storage/atomic-json-store.js";
import type { EventBus } from "./event-bus.js";

const NewTicketSchema = TicketSchema.omit({ id: true, createdAt: true, updatedAt: true }).extend({
  id: z.string().min(1).optional()
}).strict();

const TicketPatchSchema = TicketSchema.partial().omit({ id: true, createdAt: true }).strict();

type RegisteredProject = {
  root: string;
  config: ProjectConfig;
  store: AtomicJsonStore<ProjectConfig>;
  unwatch: () => void;
};

export class ProjectRegistryError extends Error {
  readonly code: "PROJECT_NOT_FOUND" | "TICKET_NOT_FOUND";

  constructor(code: ProjectRegistryError["code"], message: string) {
    super(message);
    this.name = "ProjectRegistryError";
    this.code = code;
  }
}

export class ProjectRegistry {
  readonly events: EventBus;
  #projects = new Map<string, RegisteredProject>();

  constructor(events: EventBus) {
    this.events = events;
  }

  async register(root: string): Promise<ProjectConfig> {
    const store = new AtomicJsonStore(projectConfigPath(root), ProjectConfigSchema);
    const config = await store.load();
    const existing = this.#projects.get(config.project.id);
    if (existing) {
      existing.config = config;
      return config;
    }
    const registered: RegisteredProject = {
      root,
      config,
      store,
      unwatch: () => undefined
    };
    registered.unwatch = store.watch(
      next => {
        if (next.board.revision < registered.config.board.revision) return;
        registered.config = next;
        this.events.publish({
          type: "project.updated",
          projectId: next.project.id,
          revision: next.board.revision,
          payload: { source: "file" }
        });
      },
      () => {
        this.events.publish({
          type: "config.error",
          projectId: registered.config.project.id,
          revision: registered.config.board.revision,
          payload: { message: `Configuration at ${projectConfigPath(root)} is invalid; the last valid board remains active.` }
        });
      }
    );
    this.#projects.set(config.project.id, registered);
    return config;
  }

  get(projectId: string): ProjectConfig {
    return this.#requireProject(projectId).config;
  }

  getBoard(projectId: string): ProjectConfig["board"] {
    return this.#requireProject(projectId).config.board;
  }

  list(): ProjectConfig[] {
    return [...this.#projects.values()].map(project => project.config);
  }

  unregister(projectId: string): void {
    const project = this.#requireProject(projectId);
    project.unwatch();
    this.#projects.delete(projectId);
  }

  async createTicket(projectId: string, input: unknown, expectedRevision: number): Promise<{ revision: number; ticket: Ticket }> {
    const project = this.#requireProject(projectId);
    const parsed = NewTicketSchema.parse(input);
    const now = new Date().toISOString();
    const ticket = TicketSchema.parse({
      ...parsed,
      id: parsed.id ?? `ticket-${randomUUID()}`,
      createdAt: now,
      updatedAt: now
    });
    const next = await project.store.write({
      ...project.config,
      metadata: { ...project.config.metadata, updatedAt: now },
      board: { ...project.config.board, tickets: [...project.config.board.tickets, ticket] }
    }, expectedRevision);
    project.config = next;
    this.events.publish({
      type: "ticket.created",
      projectId,
      revision: next.board.revision,
      payload: { ticket }
    });
    return { revision: next.board.revision, ticket };
  }

  async updateTicket(
    projectId: string,
    ticketId: string,
    input: unknown,
    expectedRevision: number
  ): Promise<{ revision: number; ticket: Ticket }> {
    const project = this.#requireProject(projectId);
    const index = project.config.board.tickets.findIndex(ticket => ticket.id === ticketId);
    if (index < 0) throw new ProjectRegistryError("TICKET_NOT_FOUND", `Ticket ${ticketId} was not found`);
    const parsedPatch = TicketPatchSchema.parse(input);
    const provided = input as Record<string, unknown>;
    const patch = Object.fromEntries(
      Object.entries(parsedPatch).filter(([field]) => Object.hasOwn(provided, field))
    ) as z.infer<typeof TicketPatchSchema>;
    const current = project.config.board.tickets[index];
    if (!current) throw new ProjectRegistryError("TICKET_NOT_FOUND", `Ticket ${ticketId} was not found`);
    const now = new Date().toISOString();
    const merged = { ...current, ...patch };
    if ("status" in patch && patch.status !== "blocked" && !("blocker" in patch)) merged.blocker = null;
    const ticket = TicketSchema.parse({ ...merged, id: current.id, createdAt: current.createdAt, updatedAt: now });
    const tickets = [...project.config.board.tickets];
    tickets[index] = ticket;
    const next = await project.store.write({
      ...project.config,
      metadata: { ...project.config.metadata, updatedAt: now },
      board: { ...project.config.board, tickets }
    }, expectedRevision);
    project.config = next;
    this.events.publish({
      type: "ticket.updated",
      projectId,
      revision: next.board.revision,
      payload: { ticket }
    });
    return { revision: next.board.revision, ticket };
  }

  async updatePoolMaximum(
    projectId: string,
    roleInput: unknown,
    maximumInput: unknown,
    expectedRevision: number
  ): Promise<{ revision: number; role: RoleName; maximum: number }> {
    const project = this.#requireProject(projectId);
    const role = RoleNameSchema.parse(roleInput);
    const maximum = z.number().int().min(0).max(20).parse(maximumInput);
    const now = new Date().toISOString();
    const next = await project.store.write({
      ...project.config,
      metadata: { ...project.config.metadata, updatedAt: now },
      pools: {
        ...project.config.pools,
        [role]: { ...project.config.pools[role], max: maximum }
      }
    }, expectedRevision);
    project.config = next;
    this.events.publish({
      type: "project.updated",
      projectId,
      revision: next.board.revision,
      payload: { setting: `pools.${role}.max`, maximum }
    });
    return { revision: next.board.revision, role, maximum };
  }

  async updateDonnaModel(
    projectId: string,
    modelInput: unknown,
    expectedRevision: number
  ): Promise<{ revision: number; model: string }> {
    const project = this.#requireProject(projectId);
    const model = z.string().trim().min(1).max(120).parse(modelInput);
    const now = new Date().toISOString();
    const next = await project.store.write({
      ...project.config,
      metadata: { ...project.config.metadata, updatedAt: now },
      donna: {
        model,
        reasoningEffort: project.config.donna?.reasoningEffort ?? "low",
        timeoutMs: project.config.donna?.timeoutMs ?? 180_000
      }
    }, expectedRevision);
    project.config = next;
    this.events.publish({
      type: "project.updated",
      projectId,
      revision: next.board.revision,
      payload: { setting: "donna.model", model }
    });
    return { revision: next.board.revision, model };
  }

  close(): void {
    for (const project of this.#projects.values()) project.unwatch();
    this.#projects.clear();
  }

  #requireProject(projectId: string): RegisteredProject {
    const project = this.#projects.get(projectId);
    if (!project) throw new ProjectRegistryError("PROJECT_NOT_FOUND", `Project ${projectId} was not found`);
    return project;
  }
}
