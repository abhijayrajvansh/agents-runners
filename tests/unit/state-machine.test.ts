import { describe, expect, it } from "vitest";

import { assertTransition, nextStage } from "../../src/orchestration/state-machine.js";

describe("ticket workflow state machine", () => {
  it("advances successful work through the autonomous delivery stages", () => {
    expect(nextStage("todo", { kind: "claimed", attempts: 0, maxRetries: 3 })).toBe("in_progress");
    expect(nextStage("in_progress", { kind: "passed", attempts: 0, maxRetries: 3 })).toBe("review");
    expect(nextStage("review", { kind: "passed", attempts: 0, maxRetries: 3 })).toBe("qa");
    expect(nextStage("qa", { kind: "passed", attempts: 0, maxRetries: 3 })).toBe("done");
  });

  it("returns failed review or QA to development before exhausting retries", () => {
    expect(nextStage("review", { kind: "failed", attempts: 1, maxRetries: 3 })).toBe("in_progress");
    expect(nextStage("qa", { kind: "failed", attempts: 2, maxRetries: 3 })).toBe("in_progress");
  });

  it("blocks a ticket when the retry limit is reached", () => {
    expect(nextStage("qa", { kind: "failed", attempts: 3, maxRetries: 3 })).toBe("blocked");
    expect(nextStage("in_progress", { kind: "blocked", attempts: 0, maxRetries: 3 })).toBe("blocked");
  });

  it("rejects a manual jump that bypasses delivery evidence", () => {
    expect(() => assertTransition("backlog", "done")).toThrow("backlog to done");
    expect(() => assertTransition("done", "todo")).toThrow("done to todo");
  });
});
