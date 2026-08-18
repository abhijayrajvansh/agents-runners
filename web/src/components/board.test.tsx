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
    expect(screen.getByRole("region", { name: "Review & QA" })).toBeInTheDocument();
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
});
