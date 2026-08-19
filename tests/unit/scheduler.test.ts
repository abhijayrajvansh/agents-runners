import { describe, expect, it } from "vitest";

import { RunnerPool, type RunnerRecord } from "../../src/orchestration/runner-pool.js";

describe("RunnerPool", () => {
  it("provisions stable slots lazily and respects the role maximum", async () => {
    const created: string[] = [];
    const pool = new RunnerPool("developer", 2, async (role, slot) => {
      const id = `${role}-${String(slot).padStart(2, "0")}`;
      created.push(id);
      return runner(id, role, slot);
    });

    const first = await pool.claim();
    const second = await pool.claim();
    const unavailable = await pool.claim();
    pool.release(first?.id ?? "");
    const reused = await pool.claim();

    expect(created).toEqual(["developer-01", "developer-02"]);
    expect(unavailable).toBeNull();
    expect(reused?.id).toBe("developer-01");
    expect(second?.id).toBe("developer-02");
  });

  it("honors an explicit runner assignment", async () => {
    const pool = new RunnerPool("developer", 5, async (role, slot) => runner(
      `${role}-${String(slot).padStart(2, "0")}`,
      role,
      slot
    ));

    expect((await pool.claim("developer-03"))?.id).toBe("developer-03");
  });
});

function runner(id: string, role: RunnerRecord["role"], slot: number): RunnerRecord {
  return {
    id,
    role,
    slot,
    status: "idle",
    worktreePath: `/tmp/${id}`,
    branch: `agents-runners/${id}`,
    tmuxTarget: `demo:${id}`
  };
}
