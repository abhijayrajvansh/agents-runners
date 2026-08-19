#!/usr/bin/env node

import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { Command, InvalidArgumentError } from "commander";

import { ProjectConfigSchema } from "../domain/schema.js";
import { runDonnaClient } from "./donna-client.js";
import { publicProjectUrl, readDaemonStatus, stopDaemon } from "./daemon-client.js";
import { printProjectSessions, ProjectSessionError, waitForProjectSessionEnd } from "./project-session.js";
import { runDoctor } from "../doctor/doctor.js";
import { handleSessionStart } from "../hooks/session-start.js";
import { initializeProject } from "../init/initialize-project.js";
import { pluginRootFromModule, projectConfigPath } from "../platform/paths.js";
import { isAgentKind, type AgentKind } from "../runners/agent-provider.js";
import { userRuntimeRoot } from "../platform/paths.js";
import { ensureDaemonForProject } from "../runtime/daemon-launcher.js";
import { startDaemon } from "../server/daemon.js";
import type { RunnerRecord } from "../orchestration/runner-pool.js";

const exec = promisify(execFile);

function parseAgentKind(value: string): AgentKind {
  if (!isAgentKind(value)) throw new InvalidArgumentError("Agent must be codex or claude.");
  return value;
}

export function createCli(): Command {
  const program = new Command()
    .name("agents-runners")
    .description("Local skill-driven orchestration for Codex and Claude Code")
    .option("-g, --global", "operate on every active project")
    .version("0.1.0");

  program.command("init")
    .description("Initialize Agents Runners in a Git project")
    .option("--root <path>", "project root", process.cwd())
    .option("--integration-branch <branch>", "branch receiving completed work", "dev")
    .option("--agent <agent>", "agent CLI driving the runners (codex or claude)", parseAgentKind)
    .action(async options => {
      const result = await initializeProject(options.root, {
        pluginRoot: pluginRootFromModule(import.meta.url),
        nodePath: process.execPath,
        integrationBranch: options.integrationBranch,
        ...(options.agent ? { agent: options.agent } : {})
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    });

  const hook = program.command("hook").description("Editor lifecycle hook handlers");
  hook.command("session-start").option("--agent <agent>", "calling agent", parseAgentKind).action(async () => {
    const input = JSON.parse(await readStdin()) as { cwd: string; source?: string; session_id?: string };
    const cliPath = fileURLToPath(import.meta.url);
    const output = await handleSessionStart(input, {
      ensureDaemon: async root => {
        const config = ProjectConfigSchema.parse(JSON.parse(await readFile(projectConfigPath(root), "utf8")));
        return ensureDaemonForProject(config, {
          request: async (url, options) => {
            const request: RequestInit = { method: options.method };
            if (options.body) {
              request.headers = { "content-type": "application/json" };
              request.body = JSON.stringify(options.body);
            }
            const response = await fetch(url, request);
            return { ok: response.ok };
          },
          spawnDaemon: async () => {
            const child = spawn(process.execPath, [cliPath, "daemon"], {
              detached: true,
              stdio: "ignore"
            });
            child.unref();
          },
          sleep: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
        });
      },
      openBrowser: async url => {
        await exec("open", [url]);
      }
    });
    process.stdout.write(JSON.stringify(output));
  });

  program.command("daemon")
    .description("Run the Agents Runners background daemon")
    .option("--port <port>", "loopback port", value => Number.parseInt(value, 10), 4777)
    .action(async options => {
      const daemon = await startDaemon({
        host: "127.0.0.1",
        port: options.port,
        runtimeRoot: userRuntimeRoot(),
        version: "0.1.0",
        enablePublicTunnel: true
      });
      const close = async () => {
        await daemon.close();
        process.exit(0);
      };
      process.once("SIGTERM", () => void close());
      process.once("SIGINT", () => void close());
      await new Promise(() => undefined);
    });

  program.command("start")
    .description("Start the current project in the background and open its board")
    .option("--root <path>", "initialized project root", process.cwd())
    .action(async options => {
      const config = await loadOrInitializeProject(options.root);
      const result = await ensureDaemonForProject(config, daemonDependencies(fileURLToPath(import.meta.url)));
      if (config.server.openBrowser) await exec("open", [result.url]);
      process.stdout.write("Agents Runners started in the background.\n");
      await printProjectLinks(config, result.url);
      await printResumedAssignments(config);
    });

  program.command("stop")
    .description("Stop one project, or stop the shared daemon when no project is given")
    .argument("[project]", "project id or name")
    .action(async project => {
      if (!project) {
        process.stdout.write(`${JSON.stringify(await stopDaemon(userRuntimeRoot()), null, 2)}\n`);
        return;
      }
      const status = await readDaemonStatus(userRuntimeRoot());
      if (!status.running || !status.host || !status.port) throw new Error("Agents Runners daemon is not running");
      const response = await fetch(`http://${status.host}:${status.port}/api/projects/${encodeURIComponent(project)}`, {
        method: "DELETE"
      });
      const body = await response.json() as { project?: { name?: string }; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? `Could not stop project ${project}`);
      process.stdout.write(`Stopped Agents Runners · ${body.project?.name ?? project}\n`);
      process.stdout.write("The shared daemon and other projects are still running.\n");
    });

  program.command("restart")
    .description("Restart the current project in the background and reopen its board")
    .option("--root <path>", "initialized project root", process.cwd())
    .action(async options => {
      const config = await loadOrInitializeProject(options.root);
      process.stdout.write(`Restarting Agents Runners · ${config.project.name}…\n`);
      await stopDaemon(userRuntimeRoot());
      await waitForProjectSessionEnd(config.project.repositoryRoot);
      const result = await ensureDaemonForProject(config, daemonDependencies(fileURLToPath(import.meta.url)));
      if (config.server.openBrowser) await exec("open", [result.url]);
      process.stdout.write("Agents Runners restarted in the background.\n");
      await printProjectLinks(config, result.url);
      await printResumedAssignments(config);
    });

  program.command("status")
    .description("Show shared daemon status")
    .action(async () => {
      process.stdout.write(`${JSON.stringify(await readDaemonStatus(userRuntimeRoot()), null, 2)}\n`);
    });

  program.command("ls")
    .description("List active agents for the current project")
    .option("--verbose", "show daemon, tmux, process, and worktree diagnostics")
    .action(async options => {
      await printProjectSessions(userRuntimeRoot(), {
        currentRoot: process.cwd(),
        global: Boolean(program.opts().global),
        verbose: Boolean(options.verbose)
      });
    });

  program.command("open")
    .description("Open this project in Agents Runners")
    .option("--root <path>", "initialized project root", process.cwd())
    .action(async options => {
      const config = await loadOrInitializeProject(options.root);
      const result = await ensureDaemonForProject(config, daemonDependencies(fileURLToPath(import.meta.url)));
      await exec("open", [result.url]);
    });

  program.command("doctor")
    .description("Check local Agents Runners prerequisites")
    .option("--root <path>", "initialized project root", process.cwd())
    .action(async options => {
      const report = await runDoctor({ root: options.root });
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      if (!report.ok) process.exitCode = 1;
    });

  program.command("donna")
    .description("Chat with the persistent Donna project manager")
    .option("--root <path>", "initialized project root", process.cwd())
    .action(async options => {
      const config = await loadOrInitializeProject(options.root);
      await runDonnaClient(config);
    });

  return program;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function loadProjectConfig(root: string) {
  return ProjectConfigSchema.parse(JSON.parse(await readFile(projectConfigPath(root), "utf8")));
}

async function loadOrInitializeProject(root: string) {
  try {
    return await loadProjectConfig(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const result = await initializeProject(root, {
      pluginRoot: pluginRootFromModule(import.meta.url),
      nodePath: process.execPath,
      integrationBranch: "dev",
      bootstrapRepository: true
    });
    process.stdout.write(`Initialized Agents Runners · ${result.config.project.name} · ${result.agent}\n`);
    return result.config;
  }
}

async function printResumedAssignments(config: Awaited<ReturnType<typeof loadProjectConfig>>): Promise<void> {
  const url = `http://${config.server.host}:${config.server.port}/api/projects/${encodeURIComponent(config.project.id)}/runners`;
  let assigned: RunnerRecord[] = [];
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const body = await response.json() as { runners?: RunnerRecord[] };
        assigned = (body.runners ?? []).filter(runner => runner.status === "working" && runner.ticketId);
        if (assigned.length > 0) break;
      }
    } catch {
      // The daemon may still be provisioning persistent worktrees and tmux panes.
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  if (assigned.length === 0) {
    process.stdout.write("\nNo active agent assignments to resume.\n");
    return;
  }
  process.stdout.write("\nResumed agent assignments\n");
  for (const runner of assigned) {
    process.stdout.write(`● ${runner.id} · ${runner.role} · ${runner.ticketId}\n`);
  }
}

async function printProjectLinks(config: Awaited<ReturnType<typeof loadProjectConfig>>, localUrl: string): Promise<void> {
  let status = await readDaemonStatus(userRuntimeRoot());
  for (let attempt = 0; attempt < 100 && (!status.running || !status.publicUrl); attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 100));
    status = await readDaemonStatus(userRuntimeRoot());
  }
  process.stdout.write(`Local   ${localUrl}\n`);
  const tunnelUrl = publicProjectUrl(status, config.project.id);
  process.stdout.write(tunnelUrl ? `Tunnel  ${tunnelUrl}\n` : "Tunnel  unavailable (cloudflared could not establish a connection)\n");
}

function daemonDependencies(cliPath: string) {
  return {
    request: async (url: string, options: { method: "GET" | "POST"; body?: Record<string, unknown> }) => {
      const request: RequestInit = { method: options.method };
      if (options.body) {
        request.headers = { "content-type": "application/json" };
        request.body = JSON.stringify(options.body);
      }
      const response = await fetch(url, request);
      return { ok: response.ok };
    },
    spawnDaemon: async () => {
      const child = spawn(process.execPath, [cliPath, "daemon"], { detached: true, stdio: "ignore" });
      child.unref();
    },
    sleep: (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds))
  };
}

if (isMainModule(import.meta.url)) {
  try {
    await createCli().parseAsync(process.argv);
  } catch (error) {
    if (error instanceof ProjectSessionError) {
      process.stderr.write(`error: ${error.message}\n`);
      process.exitCode = 1;
    } else if (error instanceof Error) {
      process.stderr.write(`error: ${error.message}\n`);
      process.exitCode = 1;
    } else throw error;
  }
}

function isMainModule(moduleUrl: string): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return path.resolve(process.argv[1]) === fileURLToPath(moduleUrl);
  }
}
