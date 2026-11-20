import { expect, type Locator, type Page, test } from "@playwright/test";
import type { MonacoApi } from "../../apps/web/src/components/monaco-runtime";
import { startFixtureServer } from "./fixture-server";

let fixture: Awaited<ReturnType<typeof startFixtureServer>>;
test.beforeAll(async () => {
  fixture = await startFixtureServer();
});
test.afterAll(async () => {
  await fixture.close();
});

async function wheelDown(page: Page, locator: Locator) {
  await locator.hover();
  await page.mouse.wheel(0, 600);
}

async function expectInsideViewport(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.height).toBeGreaterThan(0);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(page.viewportSize()?.height ?? 0);
}

for (const small of [false, true]) {
  test(`scrolls the ${small ? "regular" : "virtualized"} file list independently`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1100, height: 640 });
    await page.goto(`${fixture.url}/?workbench${small ? "&small" : ""}`);
    const tree = page.getByRole("tree", { name: "Файлы проекта" });
    await expectInsideViewport(page, tree);
    await wheelDown(page, tree);
    await expect.poll(() => tree.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await tree.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(
      page.getByRole("treeitem", { name: small ? "file-079.md" : "file-499.md" }),
    ).toBeVisible();
    expect(await page.getByRole("treeitem").count()).toBeLessThanOrEqual(80);
    await expectInsideViewport(page, page.locator(".app-sidebar"));
    expect(await page.evaluate(() => document.documentElement.scrollTop)).toBe(0);
  });
}

test("toggles system files and folders with the keyboard, restores the choice and fits every toolbar action at 200px", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1100, height: 640 });
  await page.goto(`${fixture.url}/?workbench&system-folders`);
  const toggle = page.getByRole("button", { name: "Показывать системные файлы и папки" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("treeitem", { name: ".pushdocs" })).toHaveCount(0);
  await page.getByRole("treeitem", { name: "docs", exact: true }).click();
  await expect(page.getByRole("treeitem", { name: "internal" })).toHaveCount(0);
  await expect(page.getByRole("treeitem", { name: "public", exact: true })).toBeVisible();
  await toggle.focus();
  await toggle.press("Space");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("treeitem", { name: ".pushdocs" }).click();
  await page.getByRole("treeitem", { name: "config.json" }).click();
  await expect(page.locator(".wb-filebar")).toHaveText(".pushdocs/config.json");
  await toggle.click();
  await expect(page.getByRole("treeitem", { name: ".pushdocs" })).toHaveCount(0);
  await expect(page.locator(".wb-filebar")).toHaveText(".pushdocs/config.json");
  await toggle.click();
  await page.getByRole("treeitem", { name: ".pushdocs" }).press("End");
  await page.getByRole("treeitem", { name: "package.json", exact: true }).click();
  await expect(page.locator(".wb-filebar")).toHaveText("package.json");
  await toggle.click();
  await expect(page.getByRole("treeitem", { name: "package.json", exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("treeitem", { name: "package.json.backup", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".wb-filebar")).toHaveText("package.json");
  await toggle.click();
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("treeitem", { name: ".pushdocs" })).toBeVisible();

  const heading = page.locator(".wb-explorer-heading");
  const headingBox = await heading.boundingBox();
  expect((await page.locator(".wb-tree").boundingBox())?.width).toBe(200);
  const buttons = heading.getByRole("button");
  await expect(buttons).toHaveCount(6);
  for (const button of await buttons.all()) {
    const box = await button.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(headingBox?.x ?? 0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
      (headingBox?.x ?? 0) + (headingBox?.width ?? 0),
    );
  }
  await page.screenshot({ path: testInfo.outputPath("system-folders-toolbar.png") });
});

for (const fallback of [false, true]) {
  test(`keeps ${fallback ? "fallback" : "Monaco"} scrolling after tab, mode and viewport changes`, async ({
    page,
  }) => {
    if (fallback) await page.route("**/monaco/**", (route) => route.abort());
    await page.goto(`${fixture.url}/?workbench`);
    const host = fallback ? page.locator(".source-overlay") : page.getByTestId("monaco-source");
    await expect(host).toBeVisible();
    async function scrollTop() {
      return fallback
        ? host.evaluate((element) => element.scrollTop)
        : page.evaluate(
            () =>
              (window as Window & { PushDocsMonaco?: MonacoApi }).PushDocsMonaco?.editor
                .getEditors()[0]
                ?.getScrollTop() ?? 0,
          );
    }
    for (const split of [false, true, false]) {
      await page.getByRole("button", { name: split ? "Две панели" : "Файл", exact: true }).click();
      await page.getByRole("tab", { name: split ? "file-001.md" : "file-000.md" }).click();
      for (const height of [640, 520]) {
        await page.setViewportSize({ width: page.viewportSize()?.width ?? 1280, height });
        await expectInsideViewport(page, host);
        const before = await scrollTop();
        await wheelDown(page, host);
        await expect.poll(scrollTop).toBeGreaterThan(before);
        expect(await page.evaluate(() => document.documentElement.scrollTop)).toBe(0);
      }
    }
  });
}
