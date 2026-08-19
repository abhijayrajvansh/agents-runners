import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { AgentService, type AgentEvent } from "../../src/runners/agent-service.js";
import { buildClaudeArgs, parseClaudeEvent } from "../../src/runners/claude-provider.js";
import { buildCodexArgs, parseCodexEvent } from "../../src/runners/codex-provider.js";
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
});

describe("Claude Code stream-json normalization", () => {
  it("reads the session id from the init frame", () => {
    expect(parseClaudeEvent('{"type":"system","subtype":"init","session_id":"session-1"}'))
      .toMatchObject({ type: "thread.started", threadId: "session-1" });
  });

  it("normalizes assistant text and the closing result frame", () => {
    expect(parseClaudeEvent('{"type":"assistant","message":{"content":[{"type":"text","text":"Implemented auth"}]}}'))
      .toMatchObject({ type: "message.completed", text: "Implemented auth" });
    expect(parseClaudeEvent('{"type":"result","subtype":"success","result":"Done"}'))
      .toMatchObject({ type: "message.completed", text: "Done" });
  });

  it("keeps tool-only turns and malformed output out of the message stream", () => {
    expect(parseClaudeEvent('{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash"}]}}'))
      .toMatchObject({ type: "agent.event" });
    expect(parseClaudeEvent("not-json")).toEqual({ type: "process.output", text: "not-json" });
  });

  it("builds new and resumed commands with explicit full-access behavior", () => {
    expect(buildClaudeArgs({ fullAccess: true, worktreePath: "/tmp/worktree", model: "opus", reasoningEffort: "high" }))
      .toEqual([
        "-p", "--output-format", "stream-json", "--verbose",
        "--model", "opus", "--effort", "high",
        "--dangerously-skip-permissions", "--add-dir", "/tmp/worktree"
      ]);
    expect(buildClaudeArgs({ threadId: "session-1", fullAccess: false, worktreePath: "/tmp/worktree" }))
      .toEqual(["-p", "--output-format", "stream-json", "--verbose", "--resume", "session-1", "--add-dir", "/tmp/worktree"]);
  });

  it("maps the Codex-only ultra effort onto the highest level Claude Code accepts", () => {
    expect(buildClaudeArgs({ fullAccess: false, worktreePath: "/tmp/worktree", reasoningEffort: "ultra" }))
      .toContain("max");
  });
});

describe("AgentService", () => {
  it("emits events while the tmux job is still running", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-events-"));
    const eventFile = path.join(root, "events.jsonl");
    let finish: ((exitCode: number) => void) | undefined;
    const completion = new Promise<number>(resolve => { finish = resolve; });
    const tmux = {
      runInPane: vi.fn(async () => ({ id: "job", eventFile, exitFile: path.join(root, "exit.json"), completion }))
    } as unknown as TmuxService;
    const service = new AgentService(tmux, new Redactor([]));
    const observed: string[] = [];
    const turn = service.runTurn({
      pane: { session: "demo", window: "developer-01", target: "demo:developer-01", cwd: root },
      runtimeDirectory: root,
      worktreePath: root,
      prompt: "Work",
      fullAccess: false
    }, (event: AgentEvent) => observed.push(event.type));

    await writeFile(eventFile, '{"type":"thread.started","thread_id":"thread-live"}\n', "utf8");
    await vi.waitFor(() => expect(observed).toContain("thread.started"));
    finish?.(0);

    await expect(turn).resolves.toMatchObject({ threadId: "thread-live", exitCode: 0 });
    await rm(root, { recursive: true, force: true });
  });

  it("parses a turn with the provider the caller selected", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-claude-"));
    const eventFile = path.join(root, "events.jsonl");
    await writeFile(eventFile, [
      '{"type":"system","subtype":"init","session_id":"session-live"}',
      '{"type":"result","subtype":"success","result":"Shipped"}'
    ].join("\n") + "\n", "utf8");
    let spec: { command: string; args: string[]; cwd?: string } | undefined;
    const runInPane = vi.fn(async (_pane: unknown, job: { command: string; args: string[]; cwd?: string }) => {
      spec = job;
      return { id: "job", eventFile, exitFile: path.join(root, "exit.json"), completion: Promise.resolve(0) };
    });
    const service = new AgentService({ runInPane } as unknown as TmuxService, new Redactor([]));

    const result = await service.runTurn({
      pane: { session: "demo", window: "developer-01", target: "demo:developer-01", cwd: root },
      runtimeDirectory: root,
      worktreePath: root,
      prompt: "Work",
      fullAccess: true,
      agent: { kind: "claude" }
    });

    expect(spec).toMatchObject({ command: "claude", cwd: root });
    expect(spec?.args).toContain("stream-json");
    expect(result).toMatchObject({ threadId: "session-live", message: "Shipped", exitCode: 0 });
    await rm(root, { recursive: true, force: true });
  });

  it("interrupts a Donna turn that exceeds its timeout", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-timeout-"));
    const eventFile = path.join(root, "events.jsonl");
    await writeFile(eventFile, "", "utf8");
    let finish: ((exitCode: number) => void) | undefined;
    const completion = new Promise<number>(resolve => { finish = resolve; });
    const tmux = {
      runInPane: vi.fn(async () => ({ id: "job", eventFile, exitFile: path.join(root, "exit.json"), completion })),
      interruptPane: vi.fn(async () => finish?.(130))
    } as unknown as TmuxService;
    const service = new AgentService(tmux, new Redactor([]));
    const turn = service.runTurn({
      pane: { session: "demo", window: "donna", target: "demo:donna", cwd: root },
      runtimeDirectory: root,
      worktreePath: root,
      prompt: "Status",
      fullAccess: false,
      timeoutMs: 5
    });
    setTimeout(() => finish?.(130), 30);

    await expect(turn).rejects.toThrow("timed out after 5ms");
    expect(tmux.interruptPane).toHaveBeenCalledWith("demo:donna");
    await rm(root, { recursive: true, force: true });
  });
});
