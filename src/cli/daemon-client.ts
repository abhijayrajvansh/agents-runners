import { readFile, rm } from "node:fs/promises";
import path from "node:path";

export type DaemonStatus = {
  running: boolean;
  pid?: number;
  host?: string;
  port?: number;
  version?: string;
  startedAt?: string;
  publicUrl?: string;
  publicAccessToken?: string;
};

export async function readDaemonStatus(runtimeRoot: string): Promise<DaemonStatus> {
  try {
    const metadata = JSON.parse(await readFile(path.join(runtimeRoot, "daemon.json"), "utf8")) as Record<string, unknown>;
    const pid = typeof metadata.pid === "number" ? metadata.pid : undefined;
    const running = pid !== undefined && isProcessAlive(pid);
    return {
      running,
      ...(pid !== undefined ? { pid } : {}),
      ...(typeof metadata.host === "string" ? { host: metadata.host } : {}),
      ...(typeof metadata.port === "number" ? { port: metadata.port } : {}),
      ...(typeof metadata.version === "string" ? { version: metadata.version } : {}),
      ...(typeof metadata.startedAt === "string" ? { startedAt: metadata.startedAt } : {}),
      ...(typeof metadata.publicUrl === "string" ? { publicUrl: metadata.publicUrl } : {}),
      ...(typeof metadata.publicAccessToken === "string" ? { publicAccessToken: metadata.publicAccessToken } : {})
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { running: false };
    throw error;
  }
}

export function publicProjectUrl(status: DaemonStatus, projectId: string): string | undefined {
  if (!status.publicUrl || !status.publicAccessToken) return undefined;
  return `${status.publicUrl}/projects/${encodeURIComponent(projectId)}?access=${encodeURIComponent(status.publicAccessToken)}`;
}

export async function stopDaemon(runtimeRoot: string): Promise<DaemonStatus> {
  const status = await readDaemonStatus(runtimeRoot);
  const metadataPath = path.join(runtimeRoot, "daemon.json");
  if (!status.running || status.pid === undefined) {
    await rm(metadataPath, { force: true });
    return status;
  }
  process.kill(status.pid, "SIGTERM");
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 50));
    if (!isProcessAlive(status.pid)) {
      await rm(metadataPath, { force: true });
      return { ...status, running: false };
    }
  }
  throw new Error(`Codex Runners daemon ${status.pid} did not stop within 2.5 seconds`);
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
