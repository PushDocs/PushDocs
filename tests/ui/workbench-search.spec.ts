import { expect, test } from "@playwright/test";
import type { MonacoApi } from "../../apps/web/src/components/monaco-runtime";
import { startFixtureServer } from "./fixture-server";
import { workbenchSearchFixture } from "./workbench-search-data";

let fixture: Awaited<ReturnType<typeof startFixtureServer>>;
test.beforeAll(async () => {
  fixture = await startFixtureServer();
});
test.afterAll(async () => {
  await fixture.close();
});

for (const fallback of [false, true]) {
  test(`${fallback ? "fallback" : "Monaco"} keeps search, results and scroll while editing articles, switching panels and reloading`, async ({
    page,
  }, testInfo) => {
    if (fallback) await page.route("**/monaco/**", (route) => route.abort());
    const saves: Array<{ files: Array<{ path: string; content: string }> }> = [];
    let revision = 0;
    await page.route(`**/api/projects/${workbenchSearchFixture.projectId}/**`, async (route) => {
      const request = route.request();
      if (request.method() === "POST") {
        saves.push(request.postDataJSON());
        await route.fulfill({ json: { saved: true, revision: ++revision } });
      } else
        await route.fulfill({
          json: { sha: "12345678", statuses: {}, branches: [{ full_ref: "main" }] },
        });
    });
    await page.goto(`${fixture.url}${workbenchSearchFixture.path}`);
    const editor = fallback
      ? page.getByRole("textbox", { name: "Исходник документа" })
      : page.getByTestId("monaco-source");
    await expect(editor).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Файлы", exact: true }).locator("svg"),
    ).toHaveCount(1);
    await expect(page.locator(".wb-quick-open")).toHaveCount(0);
    async function editorValue() {
      if (fallback) return editor.inputValue();
      return page.evaluate(() =>
        (window as Window & { PushDocsMonaco?: MonacoApi }).PushDocsMonaco?.editor
          .getEditors()[0]
          ?.getValue(),
      );
    }
    async function expectValue(value: string) {
      await expect.poll(editorValue).toBe(value);
    }
    await page.getByRole("button", { name: "Поиск", exact: true }).click();
    const search = page.getByRole("searchbox", { name: "Поиск файлов" });
    await expect(search).toBeFocused();
    await search.fill("искомое");
    const results = page.getByRole("list", { name: "Результаты поиска" });
    await expect(results.getByRole("button")).toHaveCount(40);
    await results.getByRole("button").filter({ hasText: "article-02.md" }).click();
    await expectValue("# Статья 02\n\nискомое слово в статье 02");
    await expect(search).toHaveValue("искомое");
    await expect(results.locator('[aria-current="page"]')).toContainText("article-02.md");
    const replacement = "# Статья 02\n\nисправленное слово в статье 02";
    if (fallback) await editor.fill(replacement);
    else {
      await editor.click();
      await page.evaluate(() => {
        const editor = (
          window as Window & { PushDocsMonaco?: MonacoApi }
        ).PushDocsMonaco?.editor.getEditors()[0];
        const range = editor?.getModel()?.getFullModelRange();
        if (range) editor?.setSelection(range);
      });
      await page.keyboard.insertText(replacement);
    }
    await results.getByRole("button").filter({ hasText: "article-03.md" }).click();
    await expect
      .poll(() => saves.at(-1)?.files[0])
      .toEqual({
        path: "docs/article-02.md",
        content: "# Статья 02\n\nисправленное слово в статье 02",
      });
    await expect(results.getByRole("button")).toHaveCount(39);
    await expectValue("# Статья 03\n\nискомое слово в статье 03");
    await expect(search).toHaveValue("искомое");
    const scroll = page.locator(".wb-sidebar-search .quick-open-results");
    await scroll.evaluate((element) => {
      element.scrollTop = 300;
    });
    await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBe(300);
    await page.getByRole("button", { name: "Файлы", exact: true }).click();
    await expect(page.getByRole("tree", { name: "Файлы проекта" })).toBeVisible();
    await page.getByRole("button", { name: "Поиск", exact: true }).click();
    await expect(search).toHaveValue("искомое");
    await expect(scroll).toHaveJSProperty("scrollTop", 300);
    const bounds = await page.locator(".wb-sidebar-search").boundingBox();
    const editorBounds = await editor.boundingBox();
    expect(bounds?.height).toBeGreaterThan(60);
    expect(editorBounds?.height).toBeGreaterThan(60);
    expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(
      page.viewportSize()?.height ?? 0,
    );
    await page.screenshot({ path: testInfo.outputPath("persistent-search-panel.png") });
    await page.reload();
    await expect(search).toHaveValue("искомое");
    await expect(page.getByRole("button", { name: "По тексту" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(scroll).toHaveJSProperty("scrollTop", 300);
    await page.keyboard.press("Control+p");
    await expect(search).toBeFocused();
    await expect(page.getByRole("button", { name: "По названию" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.keyboard.press("Control+Shift+f");
    await expect(page.getByRole("button", { name: "По тексту" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await search.fill("ИСКОМОЕ");
    await page.getByRole("button", { name: "Учитывать регистр" }).click();
    await expect(results.getByRole("button")).toHaveCount(0);
    await page.getByRole("button", { name: "Учитывать регистр" }).click();
    await expect(results.getByRole("button")).toHaveCount(40);
    await search.fill("иском");
    await page.getByRole("button", { name: "Слово целиком" }).click();
    await expect(results.getByRole("button")).toHaveCount(0);
    await search.fill("искомое");
    await expect(results.getByRole("button")).toHaveCount(40);
    await page.getByRole("button", { name: "Учитывать регистр" }).click();
    const inputBounds = await search.boundingBox();
    const settings = page.locator(".wb-sidebar-search .quick-open-settings");
    expect((await settings.boundingBox())?.y).toBeGreaterThanOrEqual(
      (inputBounds?.y ?? 0) + (inputBounds?.height ?? 0),
    );
    if ((page.viewportSize()?.width ?? 0) > 760) {
      const resizer = page.getByRole("separator", { name: "Ширина проводника" });
      for (let step = 0; step < 4; step++) await resizer.press("ArrowLeft");
    }
    const panelBounds = await page.locator(".wb-sidebar-search").boundingBox();
    for (const button of await settings.getByRole("button").all()) {
      const buttonBounds = await button.boundingBox();
      expect((buttonBounds?.x ?? 0) + (buttonBounds?.width ?? 0)).toBeLessThanOrEqual(
        (panelBounds?.x ?? 0) + (panelBounds?.width ?? 0),
      );
    }
    await page.screenshot({ path: testInfo.outputPath("search-options.png") });
    await page.reload();
    await expect(search).toHaveValue("искомое");
    await expect(page.getByRole("button", { name: "Учитывать регистр" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("button", { name: "Слово целиком" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
}
