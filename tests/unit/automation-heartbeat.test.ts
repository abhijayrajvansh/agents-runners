import { describe, expect, it, vi } from "vitest";

import { createGuardedHeartbeat } from "../../src/orchestration/automation-manager.js";

describe("guarded automation heartbeat", () => {
  it("does not overlap reconciles and continues after failures", async () => {
    let release: (() => void) | undefined;
    let calls = 0;
    const reconcile = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        await new Promise<void>(resolve => { release = resolve; });
        throw new Error("temporary heartbeat failure");
      }
    });
    const statuses: Array<{ ok: boolean; error?: string }> = [];
    const heartbeat = createGuardedHeartbeat(reconcile, status => statuses.push(status));

    const first = heartbeat();
    await heartbeat();
    expect(reconcile).toHaveBeenCalledTimes(1);

    release?.();
    await first;
    await heartbeat();

    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(statuses).toEqual([
      { ok: false, error: "temporary heartbeat failure" },
      { ok: true }
    ]);
  });
});
