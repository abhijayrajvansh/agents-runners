import { afterEach, describe, expect, it, vi } from "vitest";

import { DonnaService, type DonnaEvent } from "../../src/donna/donna-service.js";
import { MemoryProjectRuntime } from "../../src/runtime/project-runtime.js";
import type { CodexEvent, CodexTurnInput } from "../../src/runners/codex-service.js";
import { EventBus } from "../../src/server/event-bus.js";
import { ProjectRegistry } from "../../src/server/project-registry.js";
import { createInitializedProject } from "../helpers/initialized-project.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()));
});

describe("DonnaService", () => {
  it("persists and resumes the shared Donna model thread", async () => {
    const initialized = await createInitializedProject();
    cleanups.push(initialized.cleanup);
    const events = new EventBus();
    const registry = new ProjectRegistry(events);
    const project = await registry.register(initialized.root);
    let turn = 0;
    const codex = {
      runTurn: vi.fn(async (_input: CodexTurnInput, onEvent?: (event: CodexEvent) => void) => {
        turn += 1;
        onEvent?.({ type: "message.completed", text: `Reply ${turn}`, raw: {} });
        return { threadId: "donna-thread-1", message: `Reply ${turn}`, exitCode: 0, events: [] };
      })
    };
    const tmux = {
      ensurePane: vi.fn(async ({ session, window, cwd }) => ({ session, window, cwd, target: `${session}:${window}` }))
    };
    const runtime = new MemoryProjectRuntime();
    const donna = new DonnaService({ registry, events, codex, tmux, runtimeFor: () => runtime });

    const browserEvents = await collect(donna.send(project.project.id, "Plan authentication", "browser"));
    const terminalEvents = await collect(donna.send(project.project.id, "Continue", "terminal"));

    expect(codex.runTurn.mock.calls[0]?.[0]).not.toHaveProperty("threadId");
    expect(codex.runTurn.mock.calls[1]?.[0]).toMatchObject({ threadId: "donna-thread-1" });
    expect(codex.runTurn.mock.calls[1]?.[0].prompt).toContain("Donna: Reply 1");
    expect(browserEvents).toContainEqual(expect.objectContaining({ type: "message", text: "Reply 1" }));
    expect(terminalEvents.at(-1)).toMatchObject({ type: "completed", message: "Reply 2" });
    expect(runtime.getDonnaThread(project.project.id)).toBe("donna-thread-1");
    expect(codex.runTurn.mock.calls[0]?.[0].prompt).toContain("/to-tickets");
  });

  it("creates implementation requests in Todo and planning requests in Backlog", async () => {
    const initialized = await createInitializedProject();
    cleanups.push(initialized.cleanup);
    const events = new EventBus();
    const registry = new ProjectRegistry(events);
    const project = await registry.register(initialized.root);
    const runtime = new MemoryProjectRuntime();
    const codex = {
      runTurn: vi.fn(async () => ({
        message: "I will coordinate that.",
        exitCode: 0,
        events: [],
        threadId: "donna-thread-1"
      }))
    };
    const tmux = {
      ensurePane: vi.fn(async ({ session, window, cwd }) => ({ session, window, cwd, target: `${session}:${window}` }))
    };
    const donna = new DonnaService({ registry, events, codex, tmux, runtimeFor: () => runtime });

    await collect(donna.send(project.project.id, "Build account recovery", "browser"));
    await collect(donna.send(project.project.id, "Create a backlog idea for audit logging", "browser"));

    expect(registry.getBoard(project.project.id).tickets.map(ticket => [ticket.title, ticket.status])).toEqual([
      ["Build account recovery", "todo"],
      ["Create a backlog idea for audit logging", "backlog"]
    ]);
  });
});

async function collect(iterable: AsyncIterable<DonnaEvent>): Promise<DonnaEvent[]> {
  const events: DonnaEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}
