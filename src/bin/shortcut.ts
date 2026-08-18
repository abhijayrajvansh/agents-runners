#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const entryPath = fileURLToPath(import.meta.url);
const shortcut = path.basename(entryPath, path.extname(entryPath));
const command = shortcut === "start" ? "open" : "stop";
const cliPath = path.join(path.dirname(entryPath), "cli.mjs");
const result = spawnSync(process.execPath, [cliPath, command, ...process.argv.slice(2)], {
  stdio: "inherit"
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
