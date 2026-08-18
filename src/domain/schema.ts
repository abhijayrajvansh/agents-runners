import { z } from "zod";

export const TicketStatusSchema = z.enum([
  "backlog",
  "todo",
  "in_progress",
  "review",
  "qa",
  "blocked",
  "done"
]);

export const RoleNameSchema = z.enum(["developer", "reviewer", "qa"]);

export const TicketCommentSchema = z.object({
  id: z.string().min(1),
  author: z.string().min(1),
  body: z.string().min(1),
  createdAt: z.iso.datetime()
}).strict();

export const TicketSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(""),
  acceptanceCriteria: z.array(z.string()).default([]),
  status: TicketStatusSchema,
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  type: z.enum(["feature", "bug", "test", "review", "chore"]).default("feature"),
  tags: z.array(z.string()).default([]),
  comments: z.array(TicketCommentSchema).default([]),
  dependencies: z.array(z.string()).default([]),
  preferredRole: RoleNameSchema.optional(),
  assignedRunnerId: z.string().optional(),
  developmentInstructions: z.string().default(""),
  qaInstructions: z.string().default(""),
  environment: z.string().default("development"),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
}).strict();

const RolePoolSchema = z.object({
  max: z.number().int().min(0).max(20),
  model: z.string().min(1).optional(),
  reasoningEffort: z.enum(["low", "medium", "high", "xhigh", "max", "ultra"]).optional(),
  instructions: z.string().default("")
}).strict();

const defaultColumns = ["backlog", "todo", "in_progress", "review", "qa", "blocked", "done"] as const;
const actionableStatuses = ["todo", "in_progress", "review", "qa"] as const;

export const ProjectConfigSchema = z.object({
  version: z.literal(1),
  project: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    repositoryRoot: z.string().min(1),
    integrationBranch: z.string().min(1),
    remote: z.string().min(1).default("origin")
  }).strict(),
  server: z.object({
    host: z.literal("127.0.0.1").default("127.0.0.1"),
    port: z.number().int().min(1024).max(65_535).default(4777),
    openBrowser: z.boolean().default(true)
  }).strict().default({ host: "127.0.0.1", port: 4777, openBrowser: true }),
  donna: z.object({
    model: z.string().min(1).default("gpt-5.6-luna"),
    reasoningEffort: z.enum(["low", "medium", "high", "xhigh", "max", "ultra"]).default("low")
  }).strict().optional(),
  board: z.object({
    revision: z.number().int().nonnegative(),
    columns: z.array(TicketStatusSchema).min(1).default([...defaultColumns]),
    tickets: z.array(TicketSchema)
  }).strict(),
  automation: z.object({
    enabled: z.boolean().default(true),
    fullAccess: z.boolean().default(true),
    maxRetries: z.number().int().min(0).max(10).default(3),
    autoMerge: z.boolean().default(true),
    autoPush: z.boolean().default(true),
    actionableStatuses: z.array(TicketStatusSchema).default([...actionableStatuses])
  }).strict().default({
    enabled: true,
    fullAccess: true,
    maxRetries: 3,
    autoMerge: true,
    autoPush: true,
    actionableStatuses: [...actionableStatuses]
  }),
  pools: z.object({
    developer: RolePoolSchema.default({ max: 5, model: "gpt-5.6-sol", reasoningEffort: "medium", instructions: "" }),
    reviewer: RolePoolSchema.default({ max: 5, model: "gpt-5.6-sol", reasoningEffort: "medium", instructions: "" }),
    qa: RolePoolSchema.default({ max: 5, model: "gpt-5.6-sol", reasoningEffort: "medium", instructions: "" })
  }).strict().default({
    developer: { max: 5, model: "gpt-5.6-sol", reasoningEffort: "medium", instructions: "" },
    reviewer: { max: 5, model: "gpt-5.6-sol", reasoningEffort: "medium", instructions: "" },
    qa: { max: 5, model: "gpt-5.6-sol", reasoningEffort: "medium", instructions: "" }
  }),
  worktrees: z.object({
    root: z.string().min(1).default(".worktrees/codex-runners"),
    persistent: z.literal(true).default(true),
    branchPrefix: z.string().min(1).default("codex-runners")
  }).strict().default({ root: ".worktrees/codex-runners", persistent: true, branchPrefix: "codex-runners" }),
  environments: z.object({
    files: z.array(z.string().min(1)).default([".env", ".env.local", ".env.development"]),
    allowProduction: z.boolean().default(false),
    profiles: z.record(z.string(), z.array(z.string())).default({
      development: [".env", ".env.local", ".env.development"]
    })
  }).strict().default({
    files: [".env", ".env.local", ".env.development"],
    allowProduction: false,
    profiles: { development: [".env", ".env.local", ".env.development"] }
  }),
  verification: z.object({
    typecheck: z.array(z.string()).default([]),
    test: z.array(z.string()).default([]),
    lint: z.array(z.string()).default([]),
    build: z.array(z.string()).default([]),
    ui: z.array(z.string()).default([])
  }).strict().default({ typecheck: [], test: [], lint: [], build: [], ui: [] }),
  computerUse: z.object({
    enabled: z.boolean().default(true),
    instructions: z.string().default("Use Computer Use for human-style QA when requested.")
  }).strict().default({
    enabled: true,
    instructions: "Use Computer Use for human-style QA when requested."
  }),
  metadata: z.object({
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime()
  }).strict().default(() => {
    const now = new Date().toISOString();
    return { createdAt: now, updatedAt: now };
  })
}).strict();

export type TicketStatus = z.infer<typeof TicketStatusSchema>;
export type RoleName = z.infer<typeof RoleNameSchema>;
export type Ticket = z.infer<typeof TicketSchema>;
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
