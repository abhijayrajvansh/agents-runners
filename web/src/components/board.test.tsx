// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Board } from "./board.js";
import { projectFixture } from "../test/project-fixture.js";

afterEach(cleanup);

describe("Board", () => {
  it("renders the complete delivery workflow and an accessible move action", async () => {
    const onMove = vi.fn().mockResolvedValue(undefined);
    render(<Board project={projectFixture()} runners={[]} onMove={onMove} onOpenTicket={vi.fn()} />);

    expect(screen.getAllByRole("region")).toHaveLength(6);
    expect(screen.getByRole("region", { name: "Review" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Backlog" })).toHaveTextContent("Build authentication");
    fireEvent.click(screen.getByRole("button", { name: "Move Build authentication to Todo" }));

    expect(onMove).toHaveBeenCalledWith("auth", "todo", 4);
  });

  it("exposes ticket detail opening without making the card a nested button", () => {
    const onOpenTicket = vi.fn();
    render(<Board project={projectFixture("review")} runners={[]} onMove={vi.fn()} onOpenTicket={onOpenTicket} />);

    fireEvent.click(screen.getByRole("button", { name: "Open Build authentication" }));
    expect(onOpenTicket).toHaveBeenCalledWith("auth");
  });

  it("marks only safe human workflow destinations as droppable", () => {
    render(<Board project={projectFixture()} runners={[]} onMove={vi.fn()} onOpenTicket={vi.fn()} />);

    expect(screen.getByRole("region", { name: "Backlog" })).toHaveAttribute("data-manual-drop-target", "true");
    expect(screen.getByRole("region", { name: "Blocked" })).toHaveAttribute("data-manual-drop-target", "true");
    expect(screen.getByRole("region", { name: "In progress" })).not.toHaveAttribute("data-manual-drop-target");
    expect(screen.getByRole("region", { name: "Review" })).not.toHaveAttribute("data-manual-drop-target");
  });

  it("reveals destination hints when a ticket drag starts", async () => {
    render(<Board project={projectFixture()} runners={[]} onMove={vi.fn()} onOpenTicket={vi.fn()} />);
    const handle = screen.getByRole("button", { name: "Drag Build authentication" });
    handle.focus();

    fireEvent.keyDown(handle, { key: " ", code: "Space" });

    expect((await screen.findAllByText("Drop ticket here")).length).toBeGreaterThan(0);
  });
});
