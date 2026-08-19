import { describe, expect, it } from "vitest";

import { reconnectDelay } from "./socket.js";

describe("project socket reconnect", () => {
  it("uses bounded exponential backoff", () => {
    expect(reconnectDelay(0)).toBe(250);
    expect(reconnectDelay(1)).toBe(500);
    expect(reconnectDelay(4)).toBe(4000);
    expect(reconnectDelay(10)).toBe(5000);
  });
});
