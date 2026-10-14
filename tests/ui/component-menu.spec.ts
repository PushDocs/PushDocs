import { expect, test } from "@playwright/test";
import { startFixtureServer } from "./fixture-server";

let fixture: Awaited<ReturnType<typeof startFixtureServer>>;
test.beforeAll(async () => {
  fixture = await startFixtureServer();
});
test.afterAll(async () => {
  await fixture.close();
});

test("scrolls components within a short viewport, including after resize", async ({ page }) => {
  await page.route("**/monaco/**", (route) => route.abort());
  await page.setViewportSize({
    width: Math.min(page.viewportSize()?.width ?? 1100, 1100),
    height: 640,
  });
  await page.goto(`${fixture.url}/?workbench`);
  await page.getByText("Компонент", { exact: true }).click();
  const menu = page.getByRole("menu");
  for (const height of [640, 400]) {
    await page.setViewportSize({ width: page.viewportSize()?.width ?? 1100, height });
    await menu.hover({ position: { x: 10, y: 10 } });
    await page.mouse.wheel(0, 2000);
    await expect.poll(() => menu.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    const box = await menu.boundingBox();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(height - 8);
    await menu.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(
      page.getByRole("menuitem", { name: "Component 29", exact: true }),
    ).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollTop)).toBe(0);
  }
  await page.getByRole("menuitem", { name: "Component 29", exact: true }).click();
  await expect(menu).toBeHidden();
  await expect(page.getByRole("textbox", { name: "Исходник документа" })).toHaveValue(
    /<Component29 \/>/,
  );
});
