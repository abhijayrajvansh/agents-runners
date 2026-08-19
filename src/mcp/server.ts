#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { projectConfigPath } from "../platform/paths.js";
import { MCP_TOOL_NAMES, type McpToolName } from "./tools.js";

export type McpToolCaller = (name: McpToolName, input: Record<string, unknown>) => Promise<unknown>;

export function createMcpServer(callTool: McpToolCaller): McpServer {
  const server = new McpServer({ name: "codex-runners", version: "0.1.0" });
  for (const name of MCP_TOOL_NAMES) {
    const inputSchema = inputSchemaFor(name) as z.ZodObject<any>;
    server.registerTool(name, {
      description: descriptionFor(name),
      inputSchema
    }, async (input: Record<string, unknown>) => {
      const result = await callTool(name, input);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        structuredContent: objectResult(result)
      };
    });
  }
  return server;
}

const projectRoot = z.string().min(1).optional().describe("Absolute project root. Omit to use the configured project root.");
const expectedRevision = z.number().int().nonnegative().describe("Latest board revision returned by get_board.");
const ticketStatus = z.enum(["backlog", "todo", "in_progress", "qa", "review", "blocked"]);
const runnerRole = z.enum(["developer", "reviewer", "qa"]);
const ServerAddressSchema = z.object({
  server: z.object({
    host: z.literal("127.0.0.1").default("127.0.0.1"),
    port: z.number().int().min(1024).max(65_535).default(4777)
  }).default({ host: "127.0.0.1", port: 4777 })
});
const ticketInput = z.object({
  id: z.string().min(1).optional(),
  title: z.string().min(1),
  kind: z.enum(["issue", "spec", "ticket", "decision", "map"]).optional(),
  source: z.enum(["manual", "triage", "to_spec", "to_tickets", "wayfinder", "donna"]).optional(),
  category: z.enum(["bug", "enhancement"]).optional(),
  description: z.string().optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
  status: ticketStatus,
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  type: z.enum(["feature", "bug", "test", "review", "chore"]).optional(),
  tags: z.array(z.string()).optional(),
  comments: z.array(z.object({
    id: z.string().min(1),
    author: z.string().min(1),
    body: z.string().min(1),
    createdAt: z.iso.datetime()
  })).optional(),
  dependencies: z.array(z.string()).optional(),
  blocker: z.object({
    kind: z.enum(["dependency", "human_input"]),
    reason: z.string().min(1),
    question: z.string().min(1).optional(),
    recommendedAction: z.string().min(1).optional(),
    autoResumeAt: z.iso.datetime().optional()
  }).nullable().optional(),
  preferredRole: runnerRole.optional(),
  assignedRunnerId: z.string().nullable().optional(),
  developmentInstructions: z.string().optional(),
  qaInstructions: z.string().optional(),
  environment: z.string().optional()
}).strict();

function inputSchemaFor(name: McpToolName) {
  switch (name) {
    case "get_project":
    case "get_board":
    case "list_runners":
    case "get_activity":
      return z.object({
        projectRoot,
        ...(name === "get_activity" ? { since: z.number().int().nonnegative().optional() } : {})
      }).strict();
    case "get_ticket":
      return z.object({ projectRoot, ticketId: z.string().min(1) }).strict();
    case "create_ticket":
      return z.object({ projectRoot, expectedRevision, ticket: ticketInput }).strict();
    case "update_ticket":
      return z.object({
        projectRoot,
        ticketId: z.string().min(1),
        expectedRevision,
        patch: ticketInput.partial().strict()
      }).strict();
    case "move_ticket":
      return z.object({ projectRoot, ticketId: z.string().min(1), status: ticketStatus, expectedRevision }).strict();
    case "assign_ticket":
      return z.object({
        projectRoot,
        ticketId: z.string().min(1),
        runnerId: z.string().min(1),
        expectedRevision
      }).strict();
    case "claim_next_ticket":
      return z.object({ projectRoot, runnerId: z.string().min(1), expectedRevision }).strict();
    case "add_ticket_comment":
      return z.object({
        projectRoot,
        ticketId: z.string().min(1),
        author: z.string().min(1),
        body: z.string().min(1),
        expectedRevision
      }).strict();
    case "report_progress":
    case "complete_stage":
      return z.object({
        projectRoot,
        ticketId: z.string().min(1).optional(),
        runnerId: z.string().min(1).optional(),
        expectedRevision,
        message: z.string().optional(),
        outcome: z.string().optional(),
        findings: z.array(z.string()).optional()
      }).strict();
    case "get_runner":
      return z.object({ projectRoot, runnerId: z.string().min(1) }).strict();
    case "message_donna":
      return z.object({ projectRoot, message: z.string().min(1) }).strict();
  }
}

export async function runStdioMcpServer(
  projectRoot = process.env.CODEX_RUNNERS_PROJECT_ROOT ?? process.cwd()
): Promise<void> {
  const server = createMcpServer(async (name, input) => {
    const requestedRoot = typeof input.projectRoot === "string" && input.projectRoot.trim().length > 0
      ? input.projectRoot
      : projectRoot;
    const address = await readProjectServerAddress(requestedRoot);
    const baseUrl = `http://${address.host}:${address.port}`;
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

/**
 * The stdio bridge only needs the daemon address. Keep this parse intentionally
 * narrower than ProjectConfigSchema so an older long-lived MCP process remains
 * compatible with newer board fields written by the daemon.
 */
export async function readProjectServerAddress(root: string): Promise<{ host: string; port: number }> {
  const raw = JSON.parse(await readFile(projectConfigPath(root), "utf8")) as unknown;
  return ServerAddressSchema.parse(raw).server;
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
    move_ticket: "Move an issue through Backlog, Todo, In progress, QA, Review, or Blocked. Use the latest expectedRevision.",
    assign_ticket: "Assign an issue to a persistent runner ID such as developer-01 using the latest expectedRevision.",
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
