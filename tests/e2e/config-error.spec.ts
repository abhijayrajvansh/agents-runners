import { expect, test } from "@playwright/test";

test("keeps the last valid board visible when the config file becomes invalid", async ({ page, request }) => {
  const projects = await (await request.get("/api/projects")).json() as { projects: Array<{ id: string }> };
  const projectId = projects.projects[0]?.id;
  await page.goto(`/projects/${projectId}`);
  await expect(page.getByLabel("Project delivery board")).toBeVisible();

  await request.post("/__test/config-error");

  await expect(page.getByText(/last valid board remains active/i)).toBeVisible();
  await expect(page.getByLabel("Project delivery board")).toBeVisible();
});
