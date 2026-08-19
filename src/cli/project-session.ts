import { mkdir, open, readFile, rm, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { WebSocket } from "ws";

import type { ProjectConfig } from "../domain/types.js";
import type { RunnerRecord } from "../orchestration/runner-pool.js";
import { ProjectConfigSchema } from "../domain/schema.js";
import { projectConfigPath, projectRuntimePath } from "../platform/paths.js";
import { RuntimeStore } from "../runtime/runtime-store.js";
import { readDaemonStatus, stopDaemon } from "./daemon-client.js";

const execFileAsync = promisify(execFile);
const color = {
  green: (value: string) => process.stdout.isTTY ? `\u001b[32m${value}\u001b[0m` : value,
  red: (value: string) => process.stdout.isTTY ? `\u001b[31m${value}\u001b[0m` : value,
  cyan: (value: string) => process.stdout.isTTY ? `\u001b[36m${value}\u001b[0m` : value,
  bold: (value: string) => process.stdout.isTTY ? `\u001b[1m${value}\u001b[0m` : value,
  dim: (value: string) => process.stdout.isTTY ? `\u001b[2m${value}\u001b[0m` : value
};

type SessionRecord = {
  pid: number;
  projectId: string;
  startedAt: string;
  url: string;
};

export class ProjectSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectSessionError";
  }
}

export async function runProjectSession(
  config: ProjectConfig,
  url: string,
  runtimeRoot: string,
  onStarted?: () => Promise<void>
): Promise<void> {
  const session = await acquireProjectSession(config, url);
  try {
    await onStarted?.();
  } catch (error) {
    await session.release();
    throw error;
  }
  if (!session.acquired) {
    process.stdout.write(`Codex Runners · ${config.project.name}\n${url}\n`);
    process.stdout.write(`Reopened the existing project session (PID ${session.existingPid}).\n`);
    return;
  }
  const socketUrl = `ws://${config.server.host}:${config.server.port}/ws?projectId=${encodeURIComponent(config.project.id)}&since=0`;
  const socket = new WebSocket(socketUrl);
  let stopping = false;
  let settled = false;
  let finish!: () => void;
  let fail!: (error: Error) => void;
  const completed = new Promise<void>((resolve, reject) => {
    finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    fail = error => {
      if (settled) return;
      settled = true;
      reject(error);
    };
  });

  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    process.stdout.write("\nStopping Codex Runners…\n");
    void stopDaemon(runtimeRoot)
      .then(status => {
        process.stdout.write(status.running ? "Daemon is still running.\n" : "Codex Runners stopped.\n");
        socket.close();
        finish();
      })
      .catch(error => fail(error instanceof Error ? error : new Error(String(error))));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  socket.once("open", () => {
    process.stdout.write(`Codex Runners · ${config.project.name}\n${url}\n`);
    process.stdout.write("Live activity follows. Press Ctrl+C to stop.\n");
  });
  socket.on("message", raw => {
    try {
      const event = JSON.parse(raw.toString()) as {
        timestamp?: string;
        type?: string;
        payload?: Record<string, unknown>;
      };
      process.stdout.write(`${formatTime(event.timestamp)} ${event.type ?? "project.event"}${formatPayload(event.payload)}\n`);
    } catch {
      process.stdout.write(`${formatTime()} project.event\n`);
    }
  });
  socket.once("error", error => {
    if (!stopping) fail(error);
  });
  socket.once("close", () => {
    if (!stopping) process.stdout.write("Codex Runners session ended.\n");
    finish();
  });

  try {
    await completed;
  } finally {
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
    socket.terminate();
    await session.release();
  }
}

export type ProjectSessionListOptions = {
  currentRoot?: string;
  global?: boolean;
  verbose?: boolean;
};

export async function printProjectSessions(
  runtimeRoot: string,
  options: ProjectSessionListOptions = {}
): Promise<void> {
  const daemon = await readDaemonStatus(runtimeRoot);
  const roots = await new RuntimeStore(runtimeRoot).loadProjects();
  const selectedRoots = selectProjectRoots(roots, options.currentRoot ?? process.cwd(), options.global ?? false);
  process.stdout.write(`${color.bold("Codex Runners")}\n\n`);
  process.stdout.write(`${daemon.running ? color.green("● Running") : color.red("● Stopped")}\n`);
  if (roots.length === 0) {
    process.stdout.write(`\n${color.dim("No registered projects.")}\n`);
    return;
  }
  if (selectedRoots.length === 0) {
    throw new ProjectSessionError("This directory is not a running Codex Runners project. Use `cr -g ls` to list every active project.");
  }

  if (options.verbose) {
    await printVerboseProjectSessions(selectedRoots, daemon);
    return;
  }

  for (const root of selectedRoots) {
    try {
      const config = ProjectConfigSchema.parse(JSON.parse(await readFile(projectConfigPath(root), "utf8")));
      const runners = daemon.running ? await fetchProjectRunners(config) : [];
      process.stdout.write(`\n${formatProjectSessionSummary(config, runners)}\n`);
    } catch {
      continue;
    }
  }
}

export function selectProjectRoots(roots: string[], currentRoot: string, global: boolean): string[] {
  if (global) return roots;
  const current = path.resolve(currentRoot);
  const matches = roots.filter(root => {
    const relative = path.relative(path.resolve(root), current);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
  return matches.sort((left, right) => right.length - left.length).slice(0, 1);
}

export function formatProjectSessionSummary(config: ProjectConfig, runners: RunnerRecord[]): string {
  const tickets = new Map(config.board.tickets.map(ticket => [ticket.id, ticket.title]));
  const active = runners.filter(runner => runner.status === "working" && runner.ticketId);
  const lines = [
    `${color.bold(config.project.name)} · ${config.project.integrationBranch}`,
    `Board: ${color.cyan(`http://${config.server.host}:${config.server.port}/projects/${config.project.id}`)}`,
    "",
    `Active agents · ${active.length}`
  ];
  if (active.length === 0) {
    lines.push(color.dim("No agents are working right now."));
  } else {
    for (const runner of active) {
      lines.push(`${roleIcon(runner.role)} ${runner.id}  ${tickets.get(runner.ticketId!) ?? runner.ticketId}`);
    }
  }
  return lines.join("\n");
}

async function fetchProjectRunners(config: ProjectConfig): Promise<RunnerRecord[]> {
  try {
    const response = await fetch(
      `http://${config.server.host}:${config.server.port}/api/projects/${encodeURIComponent(config.project.id)}/runners`
    );
    if (!response.ok) return [];
    const body = await response.json() as { runners?: RunnerRecord[] };
    return body.runners ?? [];
  } catch {
    return [];
  }
}

async function printVerboseProjectSessions(
  roots: string[],
  daemon: Awaited<ReturnType<typeof readDaemonStatus>>
): Promise<void> {
  process.stdout.write(`  Daemon`);
  if (daemon.running) process.stdout.write(`  ${color.dim(`PID ${daemon.pid} · ${daemon.host}:${daemon.port}`)}`);
  process.stdout.write(`\n\n${color.bold("Projects")}\n`);
  for (const root of roots) {
    try {
      const config = ProjectConfigSchema.parse(JSON.parse(await readFile(projectConfigPath(root), "utf8")));
      const session = await readProjectSession(root);
      const foreground = Boolean(session && isProcessAlive(session.pid));
      const url = `http://${config.server.host}:${config.server.port}/projects/${config.project.id}`;
      process.stdout.write(`\n${daemon.running ? color.green("● Active") : color.red("● Inactive")}  ${color.bold(config.project.name)}`);
      if (foreground && session) process.stdout.write(`  ${color.dim(`foreground PID ${session.pid}`)}`);
      else if (daemon.running) process.stdout.write(`  ${color.dim("background")}`);
      process.stdout.write(`\n  Board   ${color.cyan(url)}\n  Repo    ${root}\n`);
      const tmux = await readTmuxSession(config.project.id);
      if (!tmux) {
        process.stdout.write(`  tmux    ${color.red("not running")}\n`);
      } else {
        process.stdout.write(`  tmux    ${color.green(tmux.name)}\n`);
        for (const pane of tmux.panes) {
          process.stdout.write(`          ${pane.window} · ${pane.command} · PID ${pane.pid}\n`);
          process.stdout.write(`          ${color.dim(pane.path)}\n`);
        }
      }
    } catch {
      continue;
    }
  }
}

function roleIcon(role: RunnerRecord["role"]): string {
  if (role === "developer") return "💻";
  if (role === "reviewer") return "🔍";
  return "🧪";
}

export async function waitForProjectSessionEnd(projectRoot: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const session = await readProjectSession(projectRoot);
    if (!session || !isProcessAlive(session.pid)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const session = await readProjectSession(projectRoot);
  throw new ProjectSessionError(
    `Timed out waiting for ${session?.projectId ?? "the project"} session${session ? ` (PID ${session.pid})` : ""} to stop`
  );
}

async function readTmuxSession(projectId: string): Promise<{
  name: string;
  panes: Array<{ window: string; command: string; pid: string; path: string }>;
} | null> {
  const name = `codex-runners-${projectId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  try {
    const result = await execFileAsync("tmux", [
      "list-panes",
      "-s",
      "-t",
      name,
      "-F",
      "#{window_name}|#{pane_current_command}|#{pane_pid}|#{pane_current_path}"
    ]);
    const panes = result.stdout.trim().split(/\r?\n/).filter(Boolean).map(line => {
      const [window = "unknown", command = "unknown", pid = "?", ...pathParts] = line.split("|");
      return { window, command, pid, path: pathParts.join("|") };
    });
    return { name, panes };
  } catch {
    return null;
  }
}

async function acquireProjectSession(config: ProjectConfig, url: string): Promise<{
  acquired: boolean;
  existingPid?: number;
  release(): Promise<void>;
}> {
  const runtimeDirectory = projectRuntimePath(config.project.repositoryRoot);
  const sessionPath = path.join(runtimeDirectory, "session.json");
  await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 });
  let handle: FileHandle;

  try {
    handle = await open(sessionPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const current = await readProjectSession(config.project.repositoryRoot);
    if (current && isProcessAlive(current.pid)) {
      return { acquired: false, existingPid: current.pid, release: async () => undefined };
    }
    await rm(sessionPath, { force: true });
    handle = await open(sessionPath, "wx", 0o600);
  }

  const record: SessionRecord = {
    pid: process.pid,
    projectId: config.project.id,
    startedAt: new Date().toISOString(),
    url
  };
  await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`);
  await handle.close();
  let released = false;
  return {
    acquired: true,
    release: async () => {
      if (released) return;
      released = true;
      await rm(sessionPath, { force: true });
    }
  };
}

async function readProjectSession(projectRoot: string): Promise<SessionRecord | null> {
  try {
    const value = JSON.parse(await readFile(path.join(projectRuntimePath(projectRoot), "session.json"), "utf8")) as Partial<SessionRecord>;
    return typeof value.pid === "number" && typeof value.projectId === "string" &&
      typeof value.startedAt === "string" && typeof value.url === "string"
      ? value as SessionRecord
      : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function formatTime(timestamp = new Date().toISOString()): string {
  const parsed = new Date(timestamp);
  return `[${Number.isNaN(parsed.valueOf()) ? timestamp : parsed.toLocaleTimeString("en-GB", { hour12: false })}]`;
}

function formatPayload(payload?: Record<string, unknown>): string {
  if (!payload) return "";
  const ticket = payload.ticket && typeof payload.ticket === "object"
    ? payload.ticket as Record<string, unknown>
    : undefined;
  const details = [payload.runnerId, payload.message, ticket?.id, ticket?.title, ticket?.status]
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  return details.length > 0 ? ` · ${details.join(" · ")}` : "";
}
