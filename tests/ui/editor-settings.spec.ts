import { expect, type Page, test } from "@playwright/test";
import type { MonacoApi } from "../../apps/web/src/components/monaco-runtime";
import { startFixtureServer } from "./fixture-server";

let fixture: Awaited<ReturnType<typeof startFixtureServer>>;
test.beforeAll(async () => {
  fixture = await startFixtureServer();
});
test.afterAll(async () => {
  await fixture.close();
});

async function choose(page: Page, label: string) {
  await page.getByRole("combobox", { name: "Перенос строк" }).click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

for (const fallback of [false, true]) {
  test(`${fallback ? "fallback" : "Monaco"} wraps source and diff, preserves content and restores the choice`, async ({
    page,
  }, testInfo) => {
    if (fallback) await page.route("**/monaco/**", (route) => route.abort());
    await page.goto(`${fixture.url}/?editor-settings&readonly`);
    const host = fallback ? page.locator(".source-overlay") : page.getByTestId("monaco-source");
    await expect(host).toBeVisible();
    async function geometry() {
      if (fallback)
        return host.evaluate((element) => ({
          width: element.clientWidth,
          scrollWidth: element.scrollWidth,
          text: (element as HTMLTextAreaElement).value,
        }));
      return page.evaluate(() => {
        const monaco = (window as Window & { PushDocsMonaco?: MonacoApi }).PushDocsMonaco;
        const editor = monaco?.editor
          .getEditors()
          .find((item) => item.getDomNode()?.closest('[data-testid="monaco-source"]'));
        return {
          width: editor?.getLayoutInfo().contentWidth ?? 0,
          scrollWidth: editor?.getScrollWidth() ?? 0,
          text: editor?.getValue(),
        };
      });
    }
    async function expectDiffWrapping(enabled: boolean, split = false) {
      const overflow = () =>
        fallback
          ? page
              .locator(".wb-diff-scroll")
              .evaluate((element) => element.scrollWidth - element.clientWidth)
          : page.evaluate((split) => {
              const monaco = (window as Window & { PushDocsMonaco?: MonacoApi }).PushDocsMonaco;
              const diff = monaco?.editor.getDiffEditors()[0];
              if (!diff) return Number.NaN;
              return Math.max(
                ...[diff.getModifiedEditor(), ...(split ? [diff.getOriginalEditor()] : [])].map(
                  (editor) => editor.getScrollWidth() - editor.getLayoutInfo().contentWidth,
                ),
              );
            }, split);
      if (enabled) await expect.poll(overflow).toBeLessThanOrEqual(1);
      else await expect.poll(overflow).toBeGreaterThan(100);
    }
    await expect.poll(async () => (await geometry()).width).toBeGreaterThan(0);
    const original = (await geometry()).text;
    await expect
      .poll(async () => {
        const size = await geometry();
        return size.scrollWidth - size.width;
      })
      .toBeLessThanOrEqual(1);
    await expectDiffWrapping(true);
    if (fallback) {
      const mirror = page.locator(".source-line");
      const numbers = page.locator(".source-line-number");
      expect((await mirror.first().boundingBox())?.height).toBeGreaterThan(24);
      expect(
        Math.abs(
          ((await mirror.nth(3).boundingBox())?.y ?? Number.NaN) -
            ((await numbers.nth(3).boundingBox())?.y ?? Number.NaN),
        ),
      ).toBeLessThan(1);
      await expect(page.locator(".wb-diff-scroll")).toBeVisible();
      expect(
        await page
          .locator(".wb-diff-scroll")
          .evaluate((element) => element.scrollWidth - element.clientWidth),
      ).toBeLessThanOrEqual(1);
    }
    await page.screenshot({ path: testInfo.outputPath("wrapped.png"), fullPage: true });
    await page.getByRole("button", { name: "К последней строке" }).click();
    if (fallback)
      await expect.poll(() => host.evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
    await choose(page, "Не переносить");
    await expectDiffWrapping(false);
    await expect
      .poll(async () => {
        const size = await geometry();
        return size.scrollWidth - size.width;
      })
      .toBeGreaterThan(100);
    expect((await geometry()).text).toBe(original);
    await page.reload();
    await expect(host).toBeVisible();
    await expect
      .poll(async () => {
        const size = await geometry();
        return size.scrollWidth - size.width;
      })
      .toBeGreaterThan(100);
    await choose(page, "Переносить");
    await expect
      .poll(async () => {
        const size = await geometry();
        return size.scrollWidth - size.width;
      })
      .toBeLessThanOrEqual(1);
    expect((await geometry()).text).toBe(original);
    await page.getByRole("button", { name: "Две колонки" }).click();
    await expectDiffWrapping(true, true);
    if (fallback)
      expect(
        await page
          .locator(".wb-diff-scroll")
          .evaluate((element) => element.scrollWidth - element.clientWidth),
      ).toBeLessThanOrEqual(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
  });
}

test("editor preferences fit the settings page", async ({ page }, testInfo) => {
  await page.goto(`${fixture.url}/?editor-settings&settings-page`);
  await expect(page.getByRole("heading", { name: "Редактор", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Редактор", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await choose(page, "Не переносить");
  await page.screenshot({ path: testInfo.outputPath("editor-settings.png"), fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
});

test("keeps settings tabs and project navigation when opening shared preferences", async ({
  page,
}, testInfo) => {
  await page.goto(`${fixture.url}/projects/one/settings`);
  const settings = page.getByRole("navigation", { name: "Разделы настроек" });
  const sidebar = page.getByRole("navigation", { name: "Разделы проекта" });
  for (const [label, suffix] of [
    ["Редактор", "editor"],
    ["MCP", "mcp"],
    ["Мой профиль", "profile"],
    ["Участники", "members"],
    ["Git-подключения", "connections"],
    ["Редактор", "editor"],
  ]) {
    await settings.getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(`${fixture.url}/projects/one/settings/${suffix}`);
    await expect(settings.getByRole("link")).toHaveCount(6);
    await expect(settings.getByRole("link", { name: label, exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(sidebar.getByRole("link", { name: "Настройки", exact: true })).toHaveClass(
      "active",
    );
    await expect(sidebar.getByRole("link", { name: "Документы", exact: true })).toHaveAttribute(
      "href",
      "/projects/one/documents?branch=main",
    );
  }
  await choose(page, "Не переносить");
  await page.screenshot({
    path: testInfo.outputPath("editor-project-context.png"),
    fullPage: true,
  });
  await page.goto(`${fixture.url}/projects/two/settings/editor`);
  await expect(page.getByRole("combobox", { name: "Перенос строк" })).toContainText(
    "Не переносить",
  );
  await expect(settings.getByRole("link", { name: "Проект", exact: true })).toHaveAttribute(
    "href",
    "/projects/two/settings",
  );
  await expect(sidebar.getByRole("link", { name: "Документы", exact: true })).toHaveAttribute(
    "href",
    "/projects/two/documents?branch=main",
  );
});
