import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CONFIG_DIRECTORY = ".agents-runners";
// Projects initialized before Claude Code support keep their original folder.
export const LEGACY_CONFIG_DIRECTORY = ".codex-runners";
export const CONFIG_FILENAME = "config.json";

export function configDirectory(projectRoot: string): string {
  const current = path.join(projectRoot, CONFIG_DIRECTORY);
  if (existsSync(current)) return current;
  const legacy = path.join(projectRoot, LEGACY_CONFIG_DIRECTORY);
  return existsSync(legacy) ? legacy : current;
}

export function projectConfigPath(projectRoot: string): string {
  return path.join(configDirectory(projectRoot), CONFIG_FILENAME);
}

export function projectRuntimePath(projectRoot: string): string {
  return path.join(configDirectory(projectRoot), "runtime");
}

export function userRuntimeRoot(): string {
  return path.join(homedir(), "Library", "Application Support", "agents-runners");
}

export function pluginRootFromModule(moduleUrl: string): string {
  const filename = fileURLToPath(moduleUrl);
  return path.resolve(path.dirname(filename), "..", "..");
}
