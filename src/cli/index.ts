#!/usr/bin/env node

import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { Command } from "commander";

import { ProjectConfigSchema } from "../domain/schema.js";
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

  return program;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await createCli().parseAsync(process.argv);
}
