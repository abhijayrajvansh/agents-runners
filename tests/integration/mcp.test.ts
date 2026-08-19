import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createMcpServer } from "../../src/mcp/server.js";
import { MCP_TOOL_NAMES } from "../../src/mcp/tools.js";
import { McpTools } from "../../src/mcp/tools.js";
import { EventBus } from "../../src/server/event-bus.js";
import { ProjectRegistry } from "../../src/server/project-registry.js";
import { createInitializedProject } from "../helpers/initialized-project.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()));
});

describe("Agents Runners MCP tools", () => {
  it("advertises and executes the complete typed MCP surface", async () => {
    const calls: string[] = [];
    const server = createMcpServer(async (name, input) => {
      calls.push(name);
      return { projectRoot: input.projectRoot, revision: 7 };
    });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const listed = await client.listTools();
    expect(listed.tools.map(tool => tool.name)).toEqual([...MCP_TOOL_NAMES]);
    const called = await client.callTool({ name: "get_board", arguments: { projectRoot: "/tmp/demo" } });
    expect(called.structuredContent).toEqual({ projectRoot: "/tmp/demo", revision: 7 });
    expect(calls).toEqual(["get_board"]);

    await client.close();
    await server.close();
  });

  it("reads the board and protects every ticket write by revision", async () => {
    const initialized = await createInitializedProject();
    cleanups.push(initialized.cleanup);
    const events = new EventBus();
    const registry = new ProjectRegistry(events);
    const tools = harness(registry, events);

    const board = await tools.call("get_board", { projectRoot: initialized.root });
    expect(board).toMatchObject({ revision: 1, tickets: [] });
    const created = await tools.call("create_ticket", {
      projectRoot: initialized.root,
      expectedRevision: 1,
      ticket: { id: "auth", title: "Build authentication", status: "backlog" }
    });
    expect(created).toMatchObject({ revision: 2, ticket: { id: "auth" } });
    await expect(tools.call("move_ticket", {
      projectRoot: initialized.root,
      ticketId: "auth",
      status: "todo",
      expectedRevision: 1
    })).rejects.toThrow(/revision/i);
    await expect(tools.call("assign_ticket", {
      projectRoot: initialized.root,
      ticketId: "auth",
      runnerId: "developer-03",
      expectedRevision: 2
    })).resolves.toMatchObject({ revision: 3, ticket: { assignedRunnerId: "developer-03" } });
  });

  it("reports progress, runners, activity, comments, and Donna replies", async () => {
    const initialized = await createInitializedProject();
    cleanups.push(initialized.cleanup);
    const events = new EventBus();
    const registry = new ProjectRegistry(events);
    const tools = harness(registry, events);
    await tools.call("get_project", { projectRoot: initialized.root });
    await tools.call("create_ticket", {
      projectRoot: initialized.root,
      expectedRevision: 1,
      ticket: { id: "auth", title: "Build authentication", status: "todo" }
    });
    await tools.call("add_ticket_comment", {
      projectRoot: initialized.root,
      ticketId: "auth",
      author: "Donna",
      body: "Use the existing auth layer.",
      expectedRevision: 2
    });
    await tools.call("report_progress", {
      projectRoot: initialized.root,
      ticketId: "auth",
      runnerId: "developer-01",
      message: "Implementing the login form",
      expectedRevision: 3
    });

    expect(await tools.call("get_ticket", { projectRoot: initialized.root, ticketId: "auth" }))
      .toMatchObject({ comments: [expect.objectContaining({ body: "Use the existing auth layer." })] });
    expect(await tools.call("list_runners", { projectRoot: initialized.root }))
      .toEqual([expect.objectContaining({ id: "developer-01" })]);
    expect(await tools.call("get_runner", { projectRoot: initialized.root, runnerId: "developer-01" }))
      .toMatchObject({ status: "idle" });
    expect(await tools.call("get_activity", { projectRoot: initialized.root }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ type: "runner.progress" })]));
    expect(await tools.call("message_donna", { projectRoot: initialized.root, message: "What is next?" }))
      .toEqual({ message: "Donna reply" });
  });
});

function harness(registry: ProjectRegistry, events: EventBus): McpTools {
  return new McpTools({
    registry,
    events,
    runners: {
      list: () => [{
        id: "developer-01",
        role: "developer",
        slot: 1,
        status: "idle",
        worktreePath: "/tmp/developer-01",
        branch: "agents-runners/developer-01",
        tmuxTarget: "demo:developer-01"
      }],
      get: (_projectId, runnerId) => runnerId === "developer-01" ? {
        id: "developer-01",
        role: "developer",
        slot: 1,
        status: "idle",
        worktreePath: "/tmp/developer-01",
        branch: "agents-runners/developer-01",
        tmuxTarget: "demo:developer-01"
      } : undefined
    },
    donna: {
      send: vi.fn(async function* () {
        yield { type: "completed" as const, projectId: "demo", message: "Donna reply" };
      })
    }
  });
}
