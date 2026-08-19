import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { CommandError, type CommandRunner } from "../process/command-runner.js";

export type TmuxPane = {
  session: string;
  window: string;
  target: string;
  cwd: string;
};

export type TmuxJobSpec = {
  command: string;
  args: string[];
  runtimeDirectory: string;
  stdin?: string;
  env?: Record<string, string>;
};

export type TmuxJob = {
  id: string;
  eventFile: string;
  exitFile: string;
  completion: Promise<number>;
};

export type InteractiveCodexSpec = {
  command: string;
  worktreePath: string;
  model?: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
  fullAccess: boolean;
  env?: Record<string, string>;
};

export class TmuxService {
  readonly commands: CommandRunner;
  readonly #interactiveStarts = new Map<string, Promise<void>>();

  constructor(commands: CommandRunner) {
    this.commands = commands;
  }

  async ensurePane(input: { session: string; window: string; cwd: string }): Promise<TmuxPane> {
    if (!await this.#hasSession(input.session)) {
      await this.commands.run("tmux", ["new-session", "-d", "-s", input.session, "-n", input.window, "-c", input.cwd]);
    } else if (!(await this.listWindows(input.session)).includes(input.window)) {
      await this.commands.run("tmux", ["new-window", "-d", "-t", input.session, "-n", input.window, "-c", input.cwd]);
    }
    return { ...input, target: `${input.session}:${input.window}` };
  }

  async runInPane(pane: TmuxPane, spec: TmuxJobSpec): Promise<TmuxJob> {
    const id = crypto.randomUUID();
    await mkdir(spec.runtimeDirectory, { recursive: true, mode: 0o700 });
    const eventFile = path.join(spec.runtimeDirectory, `${id}.events.jsonl`);
    const exitFile = path.join(spec.runtimeDirectory, `${id}.exit.json`);
    const inputFile = path.join(spec.runtimeDirectory, `${id}.input`);
    const scriptFile = path.join(spec.runtimeDirectory, `${id}.sh`);
    if (spec.stdin !== undefined) await writeFile(inputFile, spec.stdin, { encoding: "utf8", mode: 0o600 });
    const environment = Object.entries(spec.env ?? {})
      .map(([key, value]) => `${key}=${shellQuote(value)}`)
      .join(" ");
    const command = [shellQuote(spec.command), ...spec.args.map(shellQuote)].join(" ");
    const redirect = spec.stdin !== undefined ? ` < ${shellQuote(inputFile)}` : "";
    const script = `#!/bin/bash\nset +e\n${environment ? `${environment} ` : ""}${command}${redirect} 2>&1 | tee -a ${shellQuote(eventFile)}\ncode=\${PIPESTATUS[0]}\nprintf '{\"exitCode\":%s}\\n' "$code" > ${shellQuote(exitFile)}\nexit 0\n`;
    await writeFile(scriptFile, script, { encoding: "utf8", mode: 0o700 });
    await chmod(scriptFile, 0o700);
    await this.commands.run("tmux", ["send-keys", "-t", pane.target, "-l", `bash ${shellQuote(scriptFile)}`]);
    await this.commands.run("tmux", ["send-keys", "-t", pane.target, "Enter"]);
    return { id, eventFile, exitFile, completion: waitForExit(exitFile) };
  }

  async ensureInteractiveCodex(pane: TmuxPane, spec: InteractiveCodexSpec): Promise<void> {
    const pending = this.#interactiveStarts.get(pane.target);
    if (pending) return pending;
    const start = this.#startInteractiveCodex(pane, spec).finally(() => this.#interactiveStarts.delete(pane.target));
    this.#interactiveStarts.set(pane.target, start);
    return start;
  }

  async listWindows(session: string): Promise<string[]> {
    const result = await this.commands.run("tmux", ["list-windows", "-t", session, "-F", "#{window_name}"]);
    return result.stdout.split(/\r?\n/).filter(Boolean);
  }

  async killSession(session: string): Promise<void> {
    await this.commands.run("tmux", ["kill-session", "-t", session]);
  }

  async interruptPane(target: string): Promise<void> {
    await this.commands.run("tmux", ["send-keys", "-t", target, "C-c"]);
  }

  async capturePane(target: string, lines = 160): Promise<string> {
    const result = await this.commands.run("tmux", ["capture-pane", "-p", "-t", target, "-S", `-${lines}`]);
    return result.stdout;
  }

  async inspectPane(target: string): Promise<{ command: string; pid: number; cwd: string }> {
    const result = await this.commands.run("tmux", ["list-panes", "-t", target, "-F", "#{pane_current_command}\t#{pane_pid}\t#{pane_current_path}"]);
    const [command = "shell", pid = "0", cwd = ""] = result.stdout.trim().split("\t");
    return { command, pid: Number.parseInt(pid, 10) || 0, cwd };
  }

  async #startInteractiveCodex(pane: TmuxPane, spec: InteractiveCodexSpec): Promise<void> {
    const current = await this.inspectPane(pane.target);
    if (!isShellCommand(current.command)) return;
    const environment = Object.entries(spec.env ?? {})
      .map(([key, value]) => `${key}=${shellQuote(value)}`)
      .join(" ");
    const args = [
      ...(spec.model ? ["--model", spec.model] : []),
      ...(spec.reasoningEffort ? ["--config", `model_reasoning_effort=${JSON.stringify(spec.reasoningEffort)}`] : []),
      ...(spec.fullAccess ? ["--dangerously-bypass-approvals-and-sandbox"] : []),
      "--no-alt-screen",
      "-C",
      spec.worktreePath
    ];
    const command = [shellQuote(spec.command), ...args.map(shellQuote)].join(" ");
    await this.commands.run("tmux", ["send-keys", "-t", pane.target, "-l", `${environment ? `${environment} ` : ""}${command}`]);
    await this.commands.run("tmux", ["send-keys", "-t", pane.target, "Enter"]);
  }

  async #hasSession(session: string): Promise<boolean> {
    try {
      await this.commands.run("tmux", ["has-session", "-t", session]);
      return true;
    } catch (error) {
      if (error instanceof CommandError) return false;
      throw error;
    }
  }
}

function isShellCommand(command: string): boolean {
  return ["bash", "dash", "fish", "ksh", "sh", "shell", "zsh"].includes(command);
}

async function waitForExit(file: string): Promise<number> {
  const deadline = Date.now() + 4 * 60 * 60 * 1000;
  while (Date.now() < deadline) {
    try {
      await access(file);
      const value = JSON.parse(await readFile(file, "utf8")) as { exitCode?: unknown };
      if (typeof value.exitCode === "number") return value.exitCode;
    } catch {
      // The runner is still active.
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for tmux job exit file ${file}`);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
