import { afterEach, describe, expect, it, vi } from "vitest";

import { RunnersApi } from "./client.js";

afterEach(() => vi.unstubAllGlobals());

describe("RunnersApi Donna streaming", () => {
  it("delivers Donna messages before the completed event", async () => {
    const projectId = "demo";
    const events = [
      { type: "started", projectId, source: "browser" },
      { type: "message", projectId, text: "Checking the board." },
      { type: "completed", projectId, message: "Everything is moving." }
    ];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      `${events.map(event => JSON.stringify(event)).join("\n")}\n`,
      { status: 200, headers: { "content-type": "application/x-ndjson" } }
    )));
    const observed: string[] = [];

    const reply = await new RunnersApi().messageDonna(projectId, "Status", event => observed.push(event.type));

    expect(observed).toEqual(["started", "message", "completed"]);
    expect(reply).toBe("Everything is moving.");
  });
});
