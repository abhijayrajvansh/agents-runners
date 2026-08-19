import { unwatchFile, watchFile } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ZodType } from "zod";

type RevisionedDocument = {
  board: {
    revision: number;
  };
};

export class StoreError extends Error {
  readonly code: "INVALID_CONFIG" | "REVISION_CONFLICT" | "CONFIG_NOT_FOUND";
  readonly cause?: unknown;

  constructor(code: StoreError["code"], message: string, cause?: unknown) {
    super(message);
    this.name = "StoreError";
    this.code = code;
    this.cause = cause;
  }
}

export class AtomicJsonStore<T extends RevisionedDocument> {
  readonly filePath: string;
  readonly schema: ZodType<T>;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(filePath: string, schema: ZodType<T>) {
    this.filePath = filePath;
    this.schema = schema;
  }

  async load(): Promise<T> {
    let source: string;
    try {
      source = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new StoreError("CONFIG_NOT_FOUND", `Configuration not found at ${this.filePath}`, error);
      }
      throw error;
    }

    try {
      return this.schema.parse(JSON.parse(source));
    } catch (error) {
      throw new StoreError("INVALID_CONFIG", `Configuration at ${this.filePath} is invalid`, error);
    }
  }

  async write(next: T, expectedRevision?: number): Promise<T> {
    return this.#enqueue(async () => {
      const current = await this.#loadOrNull();
      const currentRevision = current?.board.revision ?? 0;
      if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
        throw new StoreError(
          "REVISION_CONFLICT",
          `Expected revision ${expectedRevision}, received ${currentRevision}`
        );
      }

      const parsed = this.schema.parse({
        ...next,
        board: {
          ...next.board,
          revision: currentRevision + 1
        }
      });
      const directory = path.dirname(this.filePath);
      const temporaryPath = path.join(
        directory,
        `.${path.basename(this.filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`
      );
      await mkdir(directory, { recursive: true });
      await writeFile(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, this.filePath);
      return parsed;
    });
  }

  watch(listener: (document: T) => void, onError?: (error: unknown) => void): () => void {
    let timer: NodeJS.Timeout | undefined;
    const notify = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void this.load().then(listener).catch(error => onError?.(error));
      }, 25);
    };
    const fileListener = () => notify();
    watchFile(this.filePath, { persistent: false, interval: 50 }, fileListener);

    return () => {
      if (timer) clearTimeout(timer);
      unwatchFile(this.filePath, fileListener);
    };
  }

  async #loadOrNull(): Promise<T | null> {
    try {
      return await this.load();
    } catch (error) {
      if (error instanceof StoreError && error.code === "CONFIG_NOT_FOUND") return null;
      throw error;
    }
  }

  #enqueue<R>(operation: () => Promise<R>): Promise<R> {
    const run = this.#queue.then(operation, operation);
    this.#queue = run.then(() => undefined, () => undefined);
    return run;
  }
}
