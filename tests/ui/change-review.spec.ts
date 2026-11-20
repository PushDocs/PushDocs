import { expect, test } from "@playwright/test";
import { startFixtureServer } from "./fixture-server";

test("groups changed files, keeps keyboard selection visible and searches across groups", async ({
  page,
}, testInfo) => {
  const server = await startFixtureServer();
  try {
    await page.route("**/api/projects/project/assets?**", (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#f0ecfb"/></svg>',
      }),
    );
    await page.goto(`${server.url}/?change-review`);
    const list = page.getByRole("listbox", { name: "Изменённые файлы" });
    const paths = [
      "content/intro.md",
      "content/start.mdx",
      "assets/banner.svg",
      "assets/screenshot.png",
      ".pushdocs/config.json",
      "assets/guide.pdf",
    ];
    await expect(list.getByRole("group")).toHaveCount(3);
    await expect(list.getByRole("group", { name: "Статьи" })).toContainText("Статьи2");
    await expect(list.getByRole("group", { name: "Изображения" })).toContainText("Изображения2");
    await expect(list.getByRole("group", { name: "Другие файлы" })).toContainText("Другие файлы2");
    expect(
      await list
        .getByRole("option")
        .evaluateAll((options) => options.map((option) => option.getAttribute("title"))),
    ).toEqual(paths);
    await page.screenshot({ path: testInfo.outputPath("groups.png"), fullPage: true });

    await list.focus();
    for (const [index, path] of paths.entries()) {
      const selected = list.getByRole("option", { selected: true });
      await expect(selected).toHaveAttribute("title", path);
      await expect(selected).toBeInViewport();
      const bounds = await selected.evaluate((option) => {
        const row = option.getBoundingClientRect();
        const viewport = option.closest("[role=listbox]")?.getBoundingClientRect();
        return {
          top: row.top,
          bottom: row.bottom,
          viewportTop: viewport?.top,
          viewportBottom: viewport?.bottom,
        };
      });
      expect(bounds.top).toBeGreaterThanOrEqual(bounds.viewportTop ?? 0);
      expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportBottom ?? 0);
      if (index < paths.length - 1) await list.press("ArrowDown");
    }
    await list.press("Home");
    await expect(list.getByRole("option", { selected: true })).toHaveAttribute(
      "title",
      paths[0] ?? "",
    );
    await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBe(0);
    await page.getByRole("button", { name: "Следующий файл" }).click();
    await page.getByRole("button", { name: "Следующий файл" }).click();
    await expect(list.getByRole("option", { selected: true })).toHaveAttribute(
      "title",
      "assets/banner.svg",
    );

    const search = page.getByRole("searchbox", { name: "Найти изменённый файл" });
    await search.fill("ASSETS/");
    await expect(list.getByRole("group")).toHaveCount(2);
    await expect(list.getByRole("group", { name: "Другие файлы" })).toContainText("Другие файлы1");
    await search.fill("missing");
    await expect(page.getByRole("status")).toHaveText("Файлы не найдены");
    await search.clear();
    await expect(list.getByRole("option", { selected: true })).toHaveAttribute(
      "title",
      "assets/banner.svg",
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  } finally {
    await server.close();
  }
});
