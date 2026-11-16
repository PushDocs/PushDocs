import { expect, test } from "@playwright/test";
import { startFixtureServer } from "./fixture-server";

let fixture: Awaited<ReturnType<typeof startFixtureServer>>;
test.beforeAll(async () => {
  fixture = await startFixtureServer();
});
test.afterAll(async () => {
  await fixture.close();
});

test("keeps importing and preserves MB while navigating between sections", async ({
  page,
}, testInfo) => {
  let starts = 0;
  let polls = 0;
  let receivedBytes = 12_500_000;
  let status = "running";
  await page.route("**/fixture/git/start", async (route) => {
    starts++;
    await route.fulfill({ json: { id: "import-job" } });
  });
  await page.route("**/fixture/git/status?*", async (route) => {
    polls++;
    await route.fulfill({
      json: { status, transferProgress: { receivedBytes, totalBytes: null } },
    });
  });
  await page.goto(`${fixture.url}/?branch-import`);
  await expect(page.getByRole("status")).toHaveText("Получаем файлы… (загружено 12,5 МБ)");
  await page.getByRole("button", { name: "MR", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Список MR" })).toBeVisible();
  receivedBytes = 18_000_000;
  const background = page.getByRole("complementary", { name: "Фоновые загрузки веток" });
  await expect(background.getByRole("status")).toHaveText("Получаем файлы… (загружено 18,0 МБ)");
  await page.getByRole("button", { name: "Документы", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Получаем файлы… (загружено 18,0 МБ)");
  expect(starts).toBe(1);
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  expect(fits).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("restored-import.png") });
  await page.getByRole("button", { name: "MR", exact: true }).click();
  status = "done";
  await expect(background).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Список MR" })).toBeVisible();
  await page.getByRole("button", { name: "Документы", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Документы загружены" })).toBeVisible();
  expect(starts).toBe(1);
  expect(polls).toBeGreaterThan(1);
});

test("does not repeat a pending import request when returning to documents", async ({ page }) => {
  let starts = 0;
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/fixture/git/start", async (route) => {
    starts++;
    await pending;
    await route.fulfill({ json: { id: "import-job" } });
  });
  await page.route("**/fixture/git/status?*", (route) =>
    route.fulfill({
      json: {
        status: "running",
        transferProgress: { receivedBytes: 7_000_000, totalBytes: null },
      },
    }),
  );
  await page.goto(`${fixture.url}/?branch-import`);
  await expect.poll(() => starts).toBe(1);
  await page.getByRole("button", { name: "MR", exact: true }).click();
  await page.getByRole("button", { name: "Документы", exact: true }).click();
  release?.();
  await expect(page.getByRole("status")).toHaveText("Получаем файлы… (загружено 7,0 МБ)");
  expect(starts).toBe(1);
});
