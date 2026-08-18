#!/usr/bin/env node

import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { Command } from "commander";

import { ProjectConfigSchema } from "../domain/schema.js";
import { runDonnaClient } from "./donna-client.js";
import { readDaemonStatus, stopDaemon } from "./daemon-client.js";
import { printProjectSessions, ProjectSessionError, waitForProjectSessionEnd } from "./project-session.js";
import { runDoctor } from "../doctor/doctor.js";
import { handleSessionStart } from "../hooks/session-start.js";
import { initializeProject } from "../init/initialize-project.js";
import { pluginRootFromModule, projectConfigPath } from "../platform/paths.js";
import { userRuntimeRoot } from "../platform/paths.js";
import { ensureDaemonForProject } from "../runtime/daemon-launcher.js";
import { startDaemon } from "../server/daemon.js";

const exec = promisify(execFile);

export function createCli(): Command {
  const program = new Command()
    .name("codex-runners")
    .description("Local autonomous Kanban orchestration for Codex")
    .version("0.1.0");

  program.command("init")
    .description("Initialize Codex Runners in a Git project")
    .option("--root <path>", "project root", process.cwd())
    .option("--integration-branch <branch>", "branch receiving completed work", "dev")
    .action(async options => {
      const result = await initializeProject(options.root, {
        pluginRoot: pluginRootFromModule(import.meta.url),
        nodePath: process.execPath,
        integrationBranch: options.integrationBranch
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    });

  const hook = program.command("hook").description("Codex lifecycle hook handlers");
  hook.command("session-start").action(async () => {
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
    .description("Run the Codex Runners background daemon")
    .option("--port <port>", "loopback port", value => Number.parseInt(value, 10), 4777)
    .action(async options => {
      const daemon = await startDaemon({
        host: "127.0.0.1",
        port: options.port,
        runtimeRoot: userRuntimeRoot(),
        version: "0.1.0"
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
      process.stdout.write(`Codex Runners started in the background.\n${result.url}\n`);
    });

  program.command("stop")
    .description("Stop the shared daemon without removing persistent runner state")
    .action(async () => {
      process.stdout.write(`${JSON.stringify(await stopDaemon(userRuntimeRoot()), null, 2)}\n`);
    });

  program.command("restart")
    .description("Restart the current project in the background and reopen its board")
    .option("--root <path>", "initialized project root", process.cwd())
    .action(async options => {
      const config = await loadOrInitializeProject(options.root);
      process.stdout.write(`Restarting Codex Runners · ${config.project.name}…\n`);
      await stopDaemon(userRuntimeRoot());
      await waitForProjectSessionEnd(config.project.repositoryRoot);
      const result = await ensureDaemonForProject(config, daemonDependencies(fileURLToPath(import.meta.url)));
      if (config.server.openBrowser) await exec("open", [result.url]);
      process.stdout.write(`Codex Runners restarted in the background.\n${result.url}\n`);
    });

  program.command("status")
    .description("Show shared daemon status")
    .action(async () => {
      process.stdout.write(`${JSON.stringify(await readDaemonStatus(userRuntimeRoot()), null, 2)}\n`);
    });

  program.command("ls")
    .description("List registered projects and active foreground sessions")
    .action(async () => {
      await printProjectSessions(userRuntimeRoot());
    });

  program.command("open")
    .description("Open this project in Codex Runners")
    .option("--root <path>", "initialized project root", process.cwd())
    .action(async options => {
      const config = await loadOrInitializeProject(options.root);
      const result = await ensureDaemonForProject(config, daemonDependencies(fileURLToPath(import.meta.url)));
      await exec("open", [result.url]);
    });

  program.command("doctor")
    .description("Check local Codex Runners prerequisites")
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
    process.stdout.write(`Initialized Codex Runners · ${result.config.project.name}\n`);
    return result.config;
  }
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
