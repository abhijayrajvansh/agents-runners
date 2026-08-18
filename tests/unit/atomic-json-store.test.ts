import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectConfigSchema } from "../../src/domain/schema.js";
import { AtomicJsonStore } from "../../src/storage/atomic-json-store.js";
import { projectConfig } from "../helpers/project-config.js";

const temporaryDirectories: string[] = [];

async function temporaryStore() {
  const directory = await mkdtemp(path.join(tmpdir(), "codex-runners-store-"));
  temporaryDirectories.push(directory);
  const file = path.join(directory, "config.json");
  return { file, store: new AtomicJsonStore(file, ProjectConfigSchema) };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe("AtomicJsonStore", () => {
  it("creates a formatted config and advances its revision", async () => {
    const { file, store } = await temporaryStore();

    const written = await store.write(projectConfig(), 0);

    expect(written.board.revision).toBe(1);
    expect(JSON.parse(await readFile(file, "utf8")).board.revision).toBe(1);
    expect(await readFile(file, "utf8")).toMatch(/\n$/);
  });

  it("rejects a write based on a stale revision", async () => {
    const { store } = await temporaryStore();
    const first = await store.write(projectConfig(), 0);

    await expect(store.write(first, 0)).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });

  it("reports invalid external JSON without replacing it", async () => {
    const { file, store } = await temporaryStore();
    await store.write(projectConfig(), 0);
    await writeFile(file, "{broken", "utf8");

    await expect(store.load()).rejects.toMatchObject({ code: "INVALID_CONFIG" });
  });

  it("notifies a watcher after a valid external edit", async () => {
    const { file, store } = await temporaryStore();
    const first = await store.write(projectConfig(), 0);
    const changed = { ...first, project: { ...first.project, name: "Renamed" } };

    const received = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("watcher did not receive config")), 3_000);
      const unwatch = store.watch(config => {
        clearTimeout(timeout);
        unwatch();
        resolve(config.project.name);
      });
    });

    await writeFile(file, JSON.stringify(changed, null, 2) + "\n", "utf8");

    await expect(received).resolves.toBe("Renamed");
  });
});
