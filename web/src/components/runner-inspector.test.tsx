// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RunnerInspector } from "./runner-inspector.js";

describe("RunnerInspector", () => {
  it("expands runner details with an accessible accordion control", () => {
    render(<RunnerInspector runners={[{
      id: "developer-01",
      role: "developer",
      slot: 1,
      status: "working",
      worktreePath: "/tmp/developer-01",
      branch: "codex-runners/developer-01",
      tmuxTarget: "northstar:developer-01",
      ticketId: "auth"
    }]} />);

    const trigger = screen.getByRole("button", { name: "Developer 01 — Working" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("codex-runners/developer-01")).toBeVisible();
    expect(screen.getByText("northstar:developer-01")).toBeVisible();
  });
});
