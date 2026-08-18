import { describe, expect, it } from "vitest";

import { buildCodexArgs, parseCodexEvent } from "../../src/runners/codex-service.js";

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
