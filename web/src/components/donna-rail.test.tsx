// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DonnaRail } from "./donna-rail.js";

describe("DonnaRail", () => {
  it("sends a message and renders Donna's shared-thread reply", async () => {
    const send = vi.fn().mockResolvedValue("I assigned authentication to Developer 01.");
    render(<DonnaRail projectName="Northstar" onSend={send} />);

    fireEvent.change(screen.getByLabelText("Message Donna"), { target: { value: "Start authentication" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(send).toHaveBeenCalledWith("Start authentication"));
    expect(await screen.findByText("I assigned authentication to Developer 01.")).toBeVisible();
  });
});
