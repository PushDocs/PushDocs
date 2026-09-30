import { expect, test } from "@playwright/test";
import { startFixtureServer } from "./fixture-server";

test("document header actions have one height and preview failure is visible", async ({ page }) => {
  const server = await startFixtureServer();
  try {
    await page.goto(`${server.url}/?preview-header&preview-error`);
    await expect(page.getByRole("alert")).toContainText("git fetch: early EOF");
    const heights = await page
      .locator(".wb-actions a, .wb-actions button")
      .evaluateAll((elements) =>
        elements
          .filter((element) => !element.closest(".settings-notification"))
          .map((element) => Math.round(element.getBoundingClientRect().height)),
      );
    expect(heights).toEqual([42, 42, 42, 42]);
  } finally {
    await server.close();
  }
});
