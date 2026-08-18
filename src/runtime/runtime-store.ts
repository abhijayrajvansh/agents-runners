import { mkdir, open, readFile, rm, writeFile, type FileHandle } from "node:fs/promises";
import path from "node:path";

export class RuntimeStoreError extends Error {
  readonly code: "DAEMON_ALREADY_RUNNING";

  constructor(message: string) {
    super(message);
    this.name = "RuntimeStoreError";
    this.code = "DAEMON_ALREADY_RUNNING";
  }
}

export class RuntimeStore {
  readonly root: string;
  readonly lockPath: string;
  readonly metadataPath: string;
  readonly projectsPath: string;

  constructor(root: string) {
    this.root = root;
    this.lockPath = path.join(root, "daemon.lock");
    this.metadataPath = path.join(root, "daemon.json");
    this.projectsPath = path.join(root, "projects.json");
  }

  async acquireLock(): Promise<() => Promise<void>> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    let handle: FileHandle;
    try {
      handle = await open(this.lockPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const pid = await this.#readLockPid();
      if (pid !== null && isProcessAlive(pid)) {
        throw new RuntimeStoreError(`Codex Runners daemon is already running with PID ${pid}`);
      }
      await rm(this.lockPath, { force: true });
      handle = await open(this.lockPath, "wx", 0o600);
    }
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`);
    await handle.close();
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      await rm(this.lockPath, { force: true });
    };
  }

  async writeMetadata(metadata: Record<string, unknown>): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await writeFile(this.metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  async loadProjects(): Promise<string[]> {
    try {
      const value = JSON.parse(await readFile(this.projectsPath, "utf8")) as unknown;
      return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      return [];
    }
  }

  async rememberProject(root: string): Promise<void> {
    const projects = new Set(await this.loadProjects());
    projects.add(root);
    await writeFile(this.projectsPath, `${JSON.stringify([...projects].sort(), null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  async #readLockPid(): Promise<number | null> {
    try {
      const value = JSON.parse(await readFile(this.lockPath, "utf8")) as { pid?: unknown };
      return typeof value.pid === "number" ? value.pid : null;
    } catch {
      return null;
    }
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
