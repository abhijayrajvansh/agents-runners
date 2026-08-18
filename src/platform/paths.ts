import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CONFIG_DIRECTORY = ".codex-runners";
export const CONFIG_FILENAME = "config.json";

export function projectConfigPath(projectRoot: string): string {
  return path.join(projectRoot, CONFIG_DIRECTORY, CONFIG_FILENAME);
}

export function projectRuntimePath(projectRoot: string): string {
  return path.join(projectRoot, CONFIG_DIRECTORY, "runtime");
}

export function userRuntimeRoot(): string {
  return path.join(homedir(), "Library", "Application Support", "codex-runners");
}

export function pluginRootFromModule(moduleUrl: string): string {
  const filename = fileURLToPath(moduleUrl);
  return path.resolve(path.dirname(filename), "..", "..");
}
