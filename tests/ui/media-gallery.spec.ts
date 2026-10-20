import { expect, test } from "@playwright/test";
import { startFixtureServer } from "./fixture-server";

let fixture: Awaited<ReturnType<typeof startFixtureServer>>;
const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGpsAAAAASUVORK5CYII=",
  "base64",
);
const mediaState = (count = 1200) => ({
  assets: Array.from({ length: count }, (_, index) => ({
    path: `${index < 600 ? "static/img" : "other"}/${index === 4 ? "long-file-name-".repeat(16) : "image-"}${String(index).padStart(4, "0")}.png`,
    url: `/img/${index}.png`,
    canDelete: true,
    inRepository: index !== 0,
    status: index === 0 ? "upload" : "clean",
    size: null,
    usages: [],
  })),
  directories: ["static/img"],
  uploadDirectory: "static/img",
  revision: 1,
  status: "open",
  role: "editor",
  locale: "ru",
});
test.beforeAll(async () => {
  fixture = await startFixtureServer();
});
test.afterAll(async () => {
  await fixture.close();
});
test.beforeEach(async ({ page }) => {
  await page.route("**/api/projects/p/media?*", (route) => route.fulfill({ json: mediaState() }));
  await page.route("**/api/projects/p/assets?*", (route) =>
    route.fulfill({ contentType: "image/png", body: pixel }),
  );
});

test("bounds mounted cards, reaches the last group, resets search and resizes the grid", async ({
  page,
}, testInfo) => {
  await page.goto(`${fixture.url}/?media`);
  const library = page.getByRole("region", { name: "Медиатека", exact: true });
  await expect(page.locator(".media-groups-virtual")).toBeAttached();
  await expect(page.locator(".media-card").first()).toBeVisible();
  expect(await page.locator(".media-card").count()).toBeLessThan(24);
  await expect(page.getByRole("heading", { name: "Новые файлы" })).toBeVisible();
  await library.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const last = page.getByRole("button", { name: "Вставить other/image-1199.png", exact: true });
  await expect(last).toBeVisible();
  expect(await page.locator(".media-card").count()).toBeLessThan(24);
  // Filtering from a far scroll offset must not leave an empty virtual viewport.
  await page.getByLabel("Найти файл").fill("image-1100");
  await expect(page.locator(".media-card")).toHaveCount(1);
  await expect(page.getByText("image-1100.png", { exact: true }).first()).toBeVisible();
  await page.getByLabel("Найти файл").fill("");
  await expect(page.getByRole("heading", { name: "Новые файлы" })).toBeVisible();
  await page.setViewportSize({ width: 600, height: 844 });
  await expect
    .poll(() =>
      page
        .locator(".media-virtual-row.asset-grid")
        .first()
        .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length),
    )
    .toBe(1);
  await library.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(last).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("virtual-gallery.png") });
});

test("skips intermediate previews during burst scrolling and reuses the session cache", async ({
  page,
}) => {
  const requested: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/assets")) requested.push(url.searchParams.get("path") ?? "");
  });
  await page.goto(`${fixture.url}/?media`);
  const library = page.getByRole("region", { name: "Медиатека", exact: true });
  await expect(page.locator(".media-preview img").first()).toBeVisible();
  const initial = requested.length;
  // Every step is faster than the 150 ms idle threshold, over hundreds of rows.
  for (let step = 1; step <= 8; step++) {
    await library.evaluate((element, fraction) => {
      element.scrollTop = (element.scrollHeight - element.clientHeight) * fraction;
    }, step / 8);
    await page.waitForTimeout(40);
  }
  expect(requested.length).toBe(initial);
  await expect(page.getByRole("img", { name: "image-1199.png", exact: true })).toBeVisible();
  expect(requested.length - initial).toBeLessThan(16);
  const afterBottom = requested.length;
  await library.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(page.getByRole("img", { name: "image-0000.png", exact: true })).toBeVisible();
  expect(requested.length).toBe(afterBottom);
});

test("keeps keyboard focus on a card when it scrolls outside the virtual range", async ({
  page,
}) => {
  await page.goto(`${fixture.url}/?media`);
  const first = page.getByRole("button", {
    name: "Вставить static/img/image-0000.png",
    exact: true,
  });
  await first.focus();
  await page.getByRole("region", { name: "Медиатека", exact: true }).evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(page.getByRole("button", { name: "Вставить other/image-1199.png" })).toBeVisible();
  await expect(first).toBeFocused();
  expect(await page.locator(".media-card").count()).toBeLessThan(24);
});

test("measures tall card rows without overlap and recovers after the list shrinks", async ({
  page,
}, testInfo) => {
  await page.goto(`${fixture.url}/?media`);
  const library = page.getByRole("region", { name: "Медиатека", exact: true });
  const longName = page.locator('.media-card strong[title*="long-file-name-"]');
  await expect(page.locator(".media-card").first()).toBeVisible();
  for (let step = 1; step <= 10 && !(await longName.count()); step++) {
    await library.evaluate((element) => {
      element.scrollTop += 200;
    });
    await page.waitForTimeout(30);
  }
  await longName.scrollIntoViewIfNeeded();
  await expect(longName).toBeVisible();
  await expect
    .poll(() =>
      page.locator(".media-virtual-row.asset-grid").evaluateAll((rows) => {
        const bounds = rows.map((row) => row.getBoundingClientRect());
        return bounds.every(
          (row, index) => index === 0 || row.top >= (bounds[index - 1]?.bottom ?? 0) - 1,
        );
      }),
    )
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath("variable-height-rows.png") });
  await library.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(page.getByRole("button", { name: "Вставить other/image-1199.png" })).toBeVisible();
  await page.route("**/api/projects/p/media?*", (route) =>
    route.fulfill({ json: { ...mediaState(90), revision: 2 } }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("pushdocs:refresh")));
  await expect(page.locator(".media-card").first()).toBeVisible();
  await library.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(
    page.getByRole("button", { name: "Вставить static/img/image-0089.png" }),
  ).toBeVisible();
});
