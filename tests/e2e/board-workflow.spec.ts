import { expect, test } from "@playwright/test";

test("creates, starts, and autonomously completes a ticket with Donna available", async ({ page, request }) => {
  const projects = await (await request.get("/api/projects")).json() as { projects: Array<{ id: string }> };
  const projectId = projects.projects[0]?.id;
  expect(projectId).toBeTruthy();
  await page.goto(`/projects/${projectId}`);

  await page.getByRole("button", { name: "Create ticket" }).click();
  const drawer = page.getByRole("dialog", { name: "Create ticket" });
  await drawer.getByLabel("Title").fill("Ship account recovery");
  await drawer.getByLabel("Description").fill("Allow a user to request a recovery link.");
  await drawer.getByRole("button", { name: "Create ticket" }).click();
  await expect(page.getByRole("region", { name: "Backlog" })).toContainText("Ship account recovery");

  await page.getByRole("button", { name: "Move Ship account recovery to Todo" }).click();
  await expect(page.getByRole("region", { name: "Done" })).toContainText("Ship account recovery");

  await page.getByLabel("Message Donna").fill("Summarize the delivery");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("I’ll coordinate that with the runner team.")).toBeVisible();
});
