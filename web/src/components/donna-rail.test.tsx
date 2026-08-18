// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DonnaRail } from "./donna-rail.js";

afterEach(cleanup);

describe("DonnaRail", () => {
  it("sends a message and renders Donna's shared-thread reply", async () => {
    const send = vi.fn().mockResolvedValue("I assigned authentication to Developer 01.");
    render(<DonnaRail projectName="Northstar" onSend={send} onCollapse={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Message Donna"), { target: { value: "Start authentication" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(send).toHaveBeenCalledWith("Start authentication"));
    expect(await screen.findByText("I assigned authentication to Developer 01.")).toBeVisible();
  });

  it("provides an explicit control for collapsing the conversation rail", () => {
    const collapse = vi.fn();
    render(<DonnaRail projectName="Northstar" onSend={vi.fn()} onCollapse={collapse} />);

    fireEvent.click(screen.getByRole("button", { name: "Collapse Donna (⌘B)" }));

    expect(collapse).toHaveBeenCalledOnce();
  });
});
