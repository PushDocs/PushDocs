import { expect, test } from "@playwright/test";
import { startFixtureServer } from "./fixture-server";

let fixture: Awaited<ReturnType<typeof startFixtureServer>>;
test.beforeAll(async () => {
  fixture = await startFixtureServer();
});
test.afterAll(async () => {
  await fixture.close();
});

test("branch menu filters completed and old branches and searches without requests", async ({
  page,
}, testInfo) => {
  await page.clock.setFixedTime(new Date("2026-11-16T12:00:00Z"));
  await page.goto(`${fixture.url}/?branch-picker`);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  const trigger = page.getByRole("combobox", { name: "Выбрать текущую ветку" });
  await trigger.click();
  await expect(page.getByText("MR открыт", { exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: /docs\/closed/ })).toHaveCount(0);
  await expect(page.getByRole("option", { name: /docs\/merged/ })).toHaveCount(0);
  await expect(page.getByRole("option", { name: /docs\/older/ })).toHaveCount(0);
  const popup = page.locator(".pd-combobox-popup");
  await expect(popup.locator("time").first()).toHaveAttribute(
    "datetime",
    "2026-11-15T12:00:00.000Z",
  );
  const toggle = page.getByRole("checkbox", { name: /Показывать влитые и закрытые/ });
  await expect(toggle).toHaveAccessibleName("Показывать влитые и закрытые (2)");
  const search = page.getByRole("combobox", { name: "Поиск по веткам" });
  await search.press("Tab");
  await expect(toggle).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.getByRole("option", { name: /docs\/merged/ })).toBeVisible();
  await expect(page.getByText("MR влит", { exact: true })).toBeVisible();
  await expect(page.getByText("MR закрыт", { exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: /docs\/older/ })).toHaveCount(0);
  const active = page.getByRole("option", { name: /docs\/active/ });
  const dateBounds = await active.locator("time").boundingBox();
  const statusBounds = await active.locator(".branch-review-state").boundingBox();
  expect(dateBounds).not.toBeNull();
  expect(statusBounds).not.toBeNull();
  expect((statusBounds?.x ?? 0) - ((dateBounds?.x ?? 0) + (dateBounds?.width ?? 0))).toBe(10);
  expect(
    await page
      .getByText("MR влит", { exact: true })
      .evaluate((element) => getComputedStyle(element).color),
  ).toBe(
    await page
      .getByText("MR закрыт", { exact: true })
      .evaluate((element) => getComputedStyle(element).color),
  );
  await search.fill("docs/merged");
  await expect(page.getByRole("option")).toHaveCount(1);
  await toggle.uncheck();
  await expect(page.getByText("Ветки не найдены", { exact: true })).toBeVisible();
  await toggle.check();
  await expect(page.getByRole("option")).toHaveCount(1);
  await search.fill("docs/older");
  await expect(page.getByRole("option")).toHaveCount(2);
  await toggle.uncheck();
  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(page.getByRole("option", { name: /docs\/older-closed/ })).toHaveCount(0);
  await toggle.check();
  await search.fill("docs/older-closed");
  await expect(page.getByRole("option")).toHaveCount(1);
  await search.fill("");
  await expect(page.getByRole("option", { name: /docs\/older/ })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("branch-menu.png") });
  const bounds = await popup.boundingBox();
  expect(bounds?.width).toBeLessThanOrEqual((page.viewportSize()?.width ?? 0) - 32);
  const list = popup.locator(".pd-combobox-list");
  expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await search.fill("docs/active");
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(popup).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("Выбрана ветка: docs/active");
  await expect(trigger).toHaveText("docs/active");
  await trigger.click();
  await expect(search).toHaveValue("");
  await expect(page.getByRole("option", { name: /docs\/older/ })).toHaveCount(0);
  expect(requests).toEqual([]);
});
