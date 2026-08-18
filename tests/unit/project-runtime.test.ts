import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { JsonProjectRuntime } from "../../src/runtime/project-runtime.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe("JsonProjectRuntime", () => {
  it("persists ticket assignments without exposing them in project config", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codex-runners-runtime-"));
    roots.push(root);
    const first = new JsonProjectRuntime(root);
    first.setTicket("demo", "auth", {
      attempts: 2,
      findings: ["Fix invalid login"],
      developerRunnerId: "developer-03"
    });

    const second = new JsonProjectRuntime(root);
    expect(second.getTicket("demo", "auth")).toMatchObject({
      attempts: 2,
      developerRunnerId: "developer-03"
    });
    expect(JSON.parse(await readFile(path.join(root, "project-runtime.json"), "utf8"))).toMatchObject({
      tickets: { "demo:auth": { attempts: 2 } }
    });
  });
});
