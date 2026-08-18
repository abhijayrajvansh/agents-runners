import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export type CommandOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  maxBuffer?: number;
};

export type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export class CommandError extends Error {
  readonly command: string;
  readonly args: string[];
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;

  constructor(command: string, args: string[], error: NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string }) {
    super(`${command} ${args.join(" ")} failed: ${error.stderr || error.message}`.trim());
    this.name = "CommandError";
    this.command = command;
    this.args = args;
    this.stdout = error.stdout ?? "";
    this.stderr = error.stderr ?? error.message;
    this.exitCode = typeof error.code === "number" ? error.code : 1;
  }
}

export class CommandRunner {
  async run(command: string, args: string[] = [], options: CommandOptions = {}): Promise<CommandResult> {
    try {
      const result = await exec(command, args, {
        cwd: options.cwd,
        env: options.env,
        encoding: "utf8",
        maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024
      });
      return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
    } catch (error) {
      throw new CommandError(command, args, error as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
        code?: number | string;
      });
    }
  }

  runShell(script: string, cwd: string, env?: NodeJS.ProcessEnv): Promise<CommandResult> {
    const options: CommandOptions = { cwd };
    if (env) options.env = env;
    return this.run("/bin/zsh", ["-lc", script], options);
  }
}
