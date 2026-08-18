import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../../src/server/app.js";
import { EventBus } from "../../src/server/event-bus.js";
import { ProjectRegistry } from "../../src/server/project-registry.js";
import { createInitializedProject } from "../helpers/initialized-project.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()));
});

describe("Codex Runners API", () => {
  it("registers a project and returns its current board", async () => {
    const project = await createInitializedProject();
    cleanups.push(project.cleanup);
    const events = new EventBus();
    const registry = new ProjectRegistry(events);
    const app = createApp({ registry, events, version: "0.1.0" });

    const registered = await request(app)
      .post("/api/projects/register")
      .send({ root: project.root })
      .expect(200);
    const board = await request(app)
      .get(`/api/projects/${registered.body.project.id}/board`)
      .expect(200);

    expect(registered.body.project.name).toBe(project.config.project.name);
    expect(board.body).toMatchObject({ revision: 1, tickets: [] });
  });

  it("creates and moves a ticket with optimistic revision protection", async () => {
    const project = await createInitializedProject();
    cleanups.push(project.cleanup);
    const events = new EventBus();
    const registry = new ProjectRegistry(events);
    const app = createApp({ registry, events, version: "0.1.0" });
    const registered = await registry.register(project.root);

    const created = await request(app)
      .post(`/api/projects/${registered.project.id}/tickets`)
      .send({
        expectedRevision: 1,
        ticket: {
          title: "Build authentication",
          description: "Add a login flow",
          status: "backlog",
          acceptanceCriteria: ["A valid user can sign in"]
        }
      })
      .expect(201);

    expect(created.body.revision).toBe(2);
    expect(created.body.ticket).toMatchObject({ title: "Build authentication", status: "backlog" });

    await request(app)
      .patch(`/api/projects/${registered.project.id}/tickets/${created.body.ticket.id}`)
      .send({ expectedRevision: 1, patch: { status: "todo" } })
      .expect(409);

    const moved = await request(app)
      .patch(`/api/projects/${registered.project.id}/tickets/${created.body.ticket.id}`)
      .send({ expectedRevision: 2, patch: { status: "todo" } })
      .expect(200);

    expect(moved.body).toMatchObject({ revision: 3, ticket: { status: "todo" } });
  });

  it("returns structured validation errors without mutating the board", async () => {
    const project = await createInitializedProject();
    cleanups.push(project.cleanup);
    const events = new EventBus();
    const registry = new ProjectRegistry(events);
    const app = createApp({ registry, events, version: "0.1.0" });
    const registered = await registry.register(project.root);

    const response = await request(app)
      .post(`/api/projects/${registered.project.id}/tickets`)
      .send({ expectedRevision: 1, ticket: { title: "", status: "shipping" } })
      .expect(400);
    const board = await registry.getBoard(registered.project.id);

    expect(response.body.error).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(board.tickets).toHaveLength(0);
    expect(board.revision).toBe(1);
  });
});
