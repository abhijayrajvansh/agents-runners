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

  it("offers new, reset, and session switching controls", async () => {
    const select = vi.fn().mockResolvedValue(undefined);
    const create = vi.fn().mockResolvedValue(undefined);
    const reset = vi.fn().mockResolvedValue(undefined);
    render(
      <DonnaRail
        projectName="Northstar"
        sessions={[
          { id: "default", title: "Main chat", createdAt: "", updatedAt: "" },
          { id: "fresh", title: "Fresh plan", createdAt: "", updatedAt: "" }
        ]}
        sessionId="default"
        onSend={vi.fn()}
        onSelectSession={select}
        onNewSession={create}
        onResetSession={reset}
        onCollapse={vi.fn()}
      />
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Donna chat session" }), { target: { value: "fresh" } });
    fireEvent.click(screen.getByRole("button", { name: "New Donna chat" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset Donna chat" }));

    await waitFor(() => {
      expect(select).toHaveBeenCalledWith("fresh");
      expect(create).toHaveBeenCalledOnce();
      expect(reset).toHaveBeenCalledOnce();
    });
  });
});
