import { mkdir, open, readFile, rm, type FileHandle } from "node:fs/promises";
import path from "node:path";

import { WebSocket } from "ws";

import type { ProjectConfig } from "../domain/types.js";
import { ProjectConfigSchema } from "../domain/schema.js";
import { projectConfigPath, projectRuntimePath } from "../platform/paths.js";
import { RuntimeStore } from "../runtime/runtime-store.js";
import { readDaemonStatus, stopDaemon } from "./daemon-client.js";

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

export async function printProjectSessions(runtimeRoot: string): Promise<void> {
  const daemon = await readDaemonStatus(runtimeRoot);
  const roots = await new RuntimeStore(runtimeRoot).loadProjects();
  process.stdout.write(`Daemon: ${daemon.running ? `running (PID ${daemon.pid})` : "stopped"}\n`);
  if (roots.length === 0) {
    process.stdout.write("No registered projects.\n");
    return;
  }

  for (const root of roots) {
    try {
      const config = ProjectConfigSchema.parse(JSON.parse(await readFile(projectConfigPath(root), "utf8")));
      const session = await readProjectSession(root);
      const state = session && isProcessAlive(session.pid) ? `active (PID ${session.pid})` : "registered";
      const url = `http://${config.server.host}:${config.server.port}/projects/${config.project.id}`;
      process.stdout.write(`- ${config.project.name}: ${state}\n  ${url}\n  ${root}\n`);
    } catch {
      continue;
    }
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
