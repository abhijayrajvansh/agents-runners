#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const entryPath = fileURLToPath(import.meta.url);
const shortcut = path.basename(entryPath, path.extname(entryPath));
const command = shortcut === "start" ? "start" : "stop";
const cliPath = path.join(path.dirname(entryPath), "cli.mjs");
const child = spawn(process.execPath, [cliPath, command, ...process.argv.slice(2)], {
  stdio: "inherit"
});

const forwardSignal = (signal: NodeJS.Signals) => {
  if (child.exitCode === null && child.signalCode === null) child.kill(signal);
};
const onInterrupt = () => forwardSignal("SIGINT");
const onTerminate = () => forwardSignal("SIGTERM");
process.on("SIGINT", onInterrupt);
process.on("SIGTERM", onTerminate);

const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => resolve({ code, signal }));
});
process.off("SIGINT", onInterrupt);
process.off("SIGTERM", onTerminate);
process.exitCode = result.code ?? (result.signal ? 128 : 1);
