import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { buildCodexArgs, CodexService, parseCodexEvent } from "../../src/runners/codex-service.js";
import type { TmuxService } from "../../src/runners/tmux-service.js";
import { Redactor } from "../../src/security/redactor.js";

describe("Codex JSONL normalization", () => {
  it("normalizes thread and final message events", () => {
    expect(parseCodexEvent('{"type":"thread.started","thread_id":"thread-1"}'))
      .toEqual({ type: "thread.started", threadId: "thread-1", raw: { type: "thread.started", thread_id: "thread-1" } });
    expect(parseCodexEvent('{"type":"item.completed","item":{"type":"agent_message","text":"Implemented auth"}}'))
      .toMatchObject({ type: "message.completed", text: "Implemented auth" });
  });

  it("preserves malformed output as a process event", () => {
    expect(parseCodexEvent("not-json")).toEqual({ type: "process.output", text: "not-json" });
  });

  it("builds new and resumed commands with explicit full-access behavior", () => {
    expect(buildCodexArgs({ fullAccess: true, worktreePath: "/tmp/worktree" }))
      .toEqual(["exec", "-", "--json", "--dangerously-bypass-approvals-and-sandbox", "-C", "/tmp/worktree"]);
    expect(buildCodexArgs({ threadId: "thread-1", fullAccess: false, worktreePath: "/tmp/worktree" }))
      .toEqual(["exec", "resume", "thread-1", "-", "--json"]);
  });

  it("emits Codex events while the tmux job is still running", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codex-events-"));
    const eventFile = path.join(root, "events.jsonl");
    let finish: ((exitCode: number) => void) | undefined;
    const completion = new Promise<number>(resolve => { finish = resolve; });
    const tmux = {
      runInPane: vi.fn(async () => ({ id: "job", eventFile, exitFile: path.join(root, "exit.json"), completion }))
    } as unknown as TmuxService;
    const service = new CodexService(tmux, new Redactor([]));
    const observed: string[] = [];
    const turn = service.runTurn({
      pane: { session: "demo", window: "developer-01", target: "demo:developer-01", cwd: root },
      runtimeDirectory: root,
      worktreePath: root,
      prompt: "Work",
      fullAccess: false
    }, event => observed.push(event.type));

    await writeFile(eventFile, '{"type":"thread.started","thread_id":"thread-live"}\n', "utf8");
    await vi.waitFor(() => expect(observed).toContain("thread.started"));
    finish?.(0);

    await expect(turn).resolves.toMatchObject({ threadId: "thread-live", exitCode: 0 });
    await rm(root, { recursive: true, force: true });
  });
});
