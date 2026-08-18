// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentTerminals } from "./agent-terminals.js";

const terminals = [
  { id: "developer-01", role: "developer", status: "working", ticketId: "search", command: "bash", pid: 101, output: "Implementing search" },
  { id: "developer-02", role: "developer", status: "idle", command: "zsh", pid: 102, output: "Waiting" }
];

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ terminals }), {
    status: 200,
    headers: { "content-type": "application/json" }
  })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AgentTerminals filters", () => {
  it("shows only active agents by default", async () => {
    render(<AgentTerminals projectId="demo" />);

    expect(await screen.findByText("developer-01")).toBeVisible();
    expect(screen.queryByText("developer-02")).not.toBeInTheDocument();
  });

  it("reveals idle agents from the All tab", async () => {
    render(<AgentTerminals projectId="demo" />);
    await screen.findByText("developer-01");

    fireEvent.click(screen.getByRole("tab", { name: /All/ }));

    expect(screen.getByText("developer-02")).toBeVisible();
  });
});
