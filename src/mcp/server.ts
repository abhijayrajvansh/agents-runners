#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { ProjectConfigSchema } from "../domain/schema.js";
import { projectConfigPath } from "../platform/paths.js";
import { MCP_TOOL_NAMES, type McpToolName } from "./tools.js";

export type McpToolCaller = (name: McpToolName, input: Record<string, unknown>) => Promise<unknown>;

export function createMcpServer(callTool: McpToolCaller): McpServer {
  const server = new McpServer({ name: "codex-runners", version: "0.1.0" });
  for (const name of MCP_TOOL_NAMES) {
    server.registerTool(name, {
      description: descriptionFor(name),
      inputSchema: z.object({ projectRoot: z.string().optional() }).loose()
    }, async input => {
      const result = await callTool(name, input);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: objectResult(result)
      };
    });
  }
  return server;
}

export async function runStdioMcpServer(
  projectRoot = process.env.CODEX_RUNNERS_PROJECT_ROOT ?? process.cwd()
): Promise<void> {
  const server = createMcpServer(async (name, input) => {
    const requestedRoot = typeof input.projectRoot === "string" && input.projectRoot.trim().length > 0
      ? input.projectRoot
      : projectRoot;
    const config = ProjectConfigSchema.parse(JSON.parse(await readFile(projectConfigPath(requestedRoot), "utf8")));
    const baseUrl = `http://${config.server.host}:${config.server.port}`;
    const response = await fetch(`${baseUrl}/api/mcp/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, projectRoot: requestedRoot })
    });
    const body = await response.json() as { error?: { message?: string } };
    if (!response.ok) throw new Error(body.error?.message ?? `Codex Runners MCP request failed with ${response.status}`);
    return body;
  });
  await server.connect(new StdioServerTransport());
}

function objectResult(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : { result: value };
}

function descriptionFor(name: McpToolName): string {
  return ({
    get_project: "Read the complete initialized Codex Runners project configuration.",
    get_board: "Read the current skill-flow board revision, columns, and issues.",
    get_ticket: "Read one issue by ID.",
    create_ticket: "Create a revision-protected issue (spec, ticket, or decision).",
    update_ticket: "Update issue fields using the expected board revision.",
    move_ticket: "Move an issue through Backlog, Todo, In progress, QA, Review, or Blocked.",
    assign_ticket: "Assign an issue to a persistent runner ID.",
    claim_next_ticket: "Claim the next dependency-ready Todo issue.",
    add_ticket_comment: "Append a visible comment to an issue.",
    report_progress: "Publish a redacted live progress event for a ticket.",
    complete_stage: "Report a structured implement, review, or verify stage result.",
    list_runners: "List provisioned persistent Developer, Reviewer, and QA runners.",
    get_runner: "Inspect a persistent runner by ID.",
    message_donna: "Send a message to the project's canonical Donna thread.",
    get_activity: "Read recent project, issue, Donna, and runner events."
  })[name];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runStdioMcpServer();
}
