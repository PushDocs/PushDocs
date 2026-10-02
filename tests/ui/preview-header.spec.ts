import { expect, test } from "@playwright/test";
import { startFixtureServer } from "./fixture-server";

test("document header actions have one height and preview failure is visible", async ({ page }) => {
  const server = await startFixtureServer();
  try {
    await page.goto(`${server.url}/?preview-header&preview-error&preview-long-error`);
    await expect(page.getByRole("alert")).toContainText("git fetch: early EOF");
    const heights = await page
      .locator(".wb-actions a, .wb-actions button")
      .evaluateAll((elements) =>
        elements
          .filter((element) => !element.closest(".settings-notification"))
          .map((element) => Math.round(element.getBoundingClientRect().height)),
      );
    expect(heights).toEqual([42, 42, 42, 42]);
    const positions = await page.getByRole("alert").evaluate((alert) => {
      const icon = alert.querySelector(":scope > svg");
      const close = alert.querySelector(":scope > button");
      const title = alert.querySelector("strong");
      if (!icon || !close || !title) throw new Error("Missing notification controls");
      return [icon, close, title].map((element) => element.getBoundingClientRect().top);
    });
    expect(Math.abs((positions[0] ?? 0) - (positions[2] ?? 0))).toBeLessThan(12);
    expect(Math.abs((positions[1] ?? 0) - (positions[2] ?? 0))).toBeLessThan(12);
  } finally {
    await server.close();
  }
});
