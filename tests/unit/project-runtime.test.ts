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

  it("keeps Donna sessions separate while preserving the shared project runtime", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codex-runners-runtime-"));
    roots.push(root);
    const runtime = new JsonProjectRuntime(root);
    runtime.appendDonnaMessage("demo", {
      author: "user",
      text: "Track the login issue",
      source: "browser"
    });
    const session = runtime.createDonnaSession("demo", "Login follow-up");
    runtime.appendDonnaMessage("demo", {
      author: "user",
      text: "Start a fresh plan",
      source: "browser"
    }, session.id);
    runtime.setTicket("demo", "auth", { attempts: 1, findings: [], developerRunnerId: "developer-01" });

    expect(runtime.listDonnaSessions("demo").map(item => item.title)).toEqual(["Main chat", "Login follow-up"]);
    expect(runtime.getDonnaMessages("demo")).toHaveLength(1);
    expect(runtime.getDonnaMessages("demo", session.id)).toHaveLength(1);
    expect(runtime.getTicket("demo", "auth")).toMatchObject({ developerRunnerId: "developer-01" });

    runtime.clearDonnaSession("demo", session.id);
    expect(runtime.getDonnaMessages("demo", session.id)).toEqual([]);
    expect(runtime.getTicket("demo", "auth")).toMatchObject({ developerRunnerId: "developer-01" });
  });
});
