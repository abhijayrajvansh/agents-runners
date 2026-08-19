import type { EventEmitter } from "node:events";
import { spawn } from "node:child_process";

export type SpawnInteractiveProcess = (
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; stdio: "inherit" }
) => EventEmitter;

type SignalTarget = {
  addListener(event: "SIGINT", listener: () => void): unknown;
  removeListener(event: "SIGINT", listener: () => void): unknown;
};

export async function launchInteractiveCodex(
  projectRoot: string,
  spawnProcess: SpawnInteractiveProcess = spawn,
  signalTarget: SignalTarget = process
): Promise<void> {
  const child = spawnProcess("codex", [], {
    cwd: projectRoot,
    env: { ...process.env, CODEX_RUNNERS_BOARD_OPENED: "1" },
    stdio: "inherit"
  });
  const keepParentAttached = () => undefined;
  signalTarget.addListener("SIGINT", keepParentAttached);
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("error", (error: Error) => {
        reject(new Error(`Could not launch Codex: ${error.message}`, { cause: error }));
      });
      child.once("exit", (code: number | null, signal: NodeJS.Signals | null) => {
        if (code === 0) resolve();
        else reject(new Error(`Codex exited with status ${code ?? signal ?? "unknown"}`));
      });
    });
  } finally {
    signalTarget.removeListener("SIGINT", keepParentAttached);
  }
}
