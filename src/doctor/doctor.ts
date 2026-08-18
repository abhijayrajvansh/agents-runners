import { readFile } from "node:fs/promises";

import { ProjectConfigSchema } from "../domain/schema.js";
import { projectConfigPath } from "../platform/paths.js";
import { CommandRunner } from "../process/command-runner.js";

export type DoctorCheck = {
  id: string;
  label: string;
  status: "ok" | "warning" | "error";
  message: string;
};

export type DoctorReport = { ok: boolean; checks: DoctorCheck[] };

export type DoctorOptions = {
  root: string;
  commands?: CommandRunner;
  fetchHealth?: (url: string) => Promise<boolean>;
};

export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const commands = options.commands ?? new CommandRunner();
  const checks: DoctorCheck[] = [];
  checks.push(await commandCheck(commands, "node", "Node.js 22+", "node", ["--version"], output => {
    const major = Number.parseInt(/v?(\d+)/.exec(output)?.[1] ?? "0", 10);
    return major >= 22 ? null : `Node.js 22 or newer is required; found ${output.trim() || "unknown"}`;
  }));
  checks.push(await commandCheck(commands, "git", "Git", "git", ["--version"]));
  checks.push(await commandCheck(commands, "tmux", "tmux", "tmux", ["-V"]));
  checks.push(await commandCheck(commands, "codex", "Codex CLI", "codex", ["--version"]));
  checks.push(await commandCheck(commands, "codex-auth", "Codex authentication", "codex", ["login", "status"]));

  let config: ReturnType<typeof ProjectConfigSchema.parse> | null = null;
  try {
    config = ProjectConfigSchema.parse(JSON.parse(await readFile(projectConfigPath(options.root), "utf8")));
    checks.push(ok("config", "Project configuration", projectConfigPath(options.root)));
  } catch (error) {
    checks.push(failed("config", "Project configuration", error));
  }

  if (config) {
    checks.push(await commandCheck(
      commands,
      "integration-branch",
      "Integration branch",
      "git",
      ["rev-parse", "--verify", config.project.integrationBranch],
      undefined,
      config.project.repositoryRoot
    ));
    const url = `http://${config.server.host}:${config.server.port}/health`;
    try {
      const healthy = await (options.fetchHealth ?? defaultFetchHealth)(url);
      checks.push(healthy ? ok("daemon", "Local daemon", url) : {
        id: "daemon", label: "Local daemon", status: "warning", message: `Not running at ${url}`
      });
    } catch (error) {
      checks.push({ id: "daemon", label: "Local daemon", status: "warning", message: errorMessage(error) });
    }
  }

  return { ok: checks.every(check => check.status !== "error"), checks };
}

async function commandCheck(
  commands: CommandRunner,
  id: string,
  label: string,
  command: string,
  args: string[],
  validate?: (output: string) => string | null,
  cwd?: string
): Promise<DoctorCheck> {
  try {
    const result = await commands.run(command, args, cwd ? { cwd } : {});
    const validation = validate?.(result.stdout);
    return validation ? { id, label, status: "error", message: validation } : ok(id, label, result.stdout.trim() || "Available");
  } catch (error) {
    return failed(id, label, error);
  }
}

function ok(id: string, label: string, message: string): DoctorCheck {
  return { id, label, status: "ok", message };
}

function failed(id: string, label: string, error: unknown): DoctorCheck {
  return { id, label, status: "error", message: errorMessage(error) };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function defaultFetchHealth(url: string): Promise<boolean> {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}
