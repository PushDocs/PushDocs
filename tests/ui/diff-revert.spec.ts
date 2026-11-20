import { expect, type Page, test } from "@playwright/test";
import type { MonacoApi } from "../../apps/web/src/components/monaco-runtime";
import { startFixtureServer } from "./fixture-server";

const before =
  "first old\nsecond old\nkeep 1\nkeep 2\nkeep 3\nkeep 4\nkeep 5\nkeep 6\nlast old\nremoved\nend\n";
const after =
  "first new\nsecond new\nkeep 1\nkeep 2\nkeep 3\nkeep 4\nkeep 5\nkeep 6\nlast new\nend\n";
let fixture: Awaited<ReturnType<typeof startFixtureServer>>;
test.beforeAll(async () => {
  fixture = await startFixtureServer();
});
test.afterAll(async () => {
  await fixture.close();
});

async function setup(
  page: Page,
  firstResult = after.replace("first new\nsecond new", "first old\nsecond old"),
) {
  const state = { content: after, revision: 7 };
  const commands: {
    branch: string;
    path: string;
    expectedRevision: number;
    expectedHeadSha: string;
    lineIds: number[];
  }[] = [];
  await page.route("**/api/projects/project/changes", async (route) => {
    const command = route.request().postDataJSON();
    commands.push(command);
    expect(command.expectedRevision).toBe(state.revision);
    state.content = commands.length === 1 ? firstResult : before;
    state.revision++;
    await route.fulfill({ json: { ...state, reverted: state.content === before } });
  });
  await page.route("**/fixture-changes", (route) => route.fulfill({ json: state }));
  return { state, commands };
}

async function hoverLine(page: Page, line: number, fallback: boolean, split: boolean) {
  if (fallback) {
    const row = page.locator(
      `${split ? ".wb-diff-pair" : ".wb-diff-row"}[data-new-number="${line}"]`,
    );
    await row.hover({ position: { x: 150, y: 10 } });
    return row.getByRole("group", { name: "Действия со строкой" });
  }
  await expect
    .poll(() =>
      page.evaluate(() => {
        const monaco = (window as Window & { PushDocsMonaco?: MonacoApi }).PushDocsMonaco;
        return monaco?.editor.getDiffEditors()[0]?.getLineChanges() !== null;
      }),
    )
    .toBe(true);
  const point = await page.evaluate((line) => {
    const monaco = (window as Window & { PushDocsMonaco?: MonacoApi }).PushDocsMonaco;
    const editor = monaco?.editor.getDiffEditors()[0]?.getModifiedEditor();
    const position = editor?.getScrolledVisiblePosition({ lineNumber: line, column: 1 });
    const bounds = editor?.getDomNode()?.getBoundingClientRect();
    if (!bounds || !position) throw new Error("Diff line is not visible");
    return { x: bounds.left + position.left + 20, y: bounds.top + position.top + 10 };
  }, line);
  await page.mouse.move(point.x, point.y);
  return page.locator(".wb-diff-hover-actions").getByRole("group", { name: "Действия со строкой" });
}

for (const fallback of [false, true]) {
  for (const split of [false, true]) {
    test(`${fallback ? "fallback" : "Monaco"} reverts individual hunks in ${split ? "split" : "unified"} view`, async ({
      page,
    }, testInfo) => {
      if (fallback) await page.route("**/monaco/**", (route) => route.abort());
      const { state, commands } = await setup(page);
      await page.goto(`${fixture.url}/?change-review&revert`);
      if (!fallback) await expect(page.getByTestId("monaco-diff")).toBeVisible();
      if (split) await page.getByRole("button", { name: "Две колонки" }).click();
      const actions = await hoverLine(page, 1, fallback, split);
      const control = actions.getByRole("button", { name: "Откатить фрагмент", exact: true });
      await expect(control).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("revert-controls.png"), fullPage: true });
      await control.click();
      await expect.poll(() => commands.length).toBe(1);
      expect(commands[0]).toEqual({
        branch: "docs/update",
        path: "content/intro.md",
        expectedRevision: 7,
        expectedHeadSha: "head",
        lineIds: [0, 1, 2, 3],
      });
      expect(state.content).toBe(after.replace("first new\nsecond new", "first old\nsecond old"));
      await expect(page.getByLabel("Добавлено строк: 1")).toBeVisible();
      const remaining = await hoverLine(page, 9, fallback, split);
      await remaining.getByRole("button", { name: "Откатить фрагмент", exact: true }).click();
      await expect.poll(() => commands.length).toBe(2);
      expect(commands[1]?.expectedRevision).toBe(8);
      expect(state.content).toBe(before);
      await expect(page.getByText("Нет изменений", { exact: true })).toBeVisible();
    });
  }
}

test("reverts only a selected replacement line through the Monaco context menu", async ({
  page,
}) => {
  const { state, commands } = await setup(page, after.replace("first new", "first old"));
  await page.goto(`${fixture.url}/?change-review&revert`);
  await expect(page.getByTestId("monaco-diff")).toBeVisible();
  await page.evaluate(() => {
    const monaco = (window as Window & { PushDocsMonaco?: MonacoApi }).PushDocsMonaco;
    if (!monaco) throw new Error("Monaco did not load");
    const editor = monaco.editor.getDiffEditors()[0]?.getModifiedEditor();
    editor?.setSelection(new monaco.Range(1, 1, 2, 1));
    editor?.focus();
  });
  await page.keyboard.press("Shift+F10");
  // Monaco guards menu mouse-up handlers for 100 ms after opening.
  await page.getByRole("menuitem", { name: "Откатить выбранные строки" }).click({ delay: 150 });
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]?.lineIds).toEqual([0, 2]);
  expect(state.content).toBe(after.replace("first new", "first old"));
});

test("keeps the diff read-only without a caret or lightbulb and preserves copying", async ({
  page,
  context,
}) => {
  const { commands } = await setup(page);
  await page.goto(`${fixture.url}/?change-review&revert`);
  await expect(page.getByTestId("monaco-diff")).toBeVisible();
  await page.evaluate(() => {
    const monaco = (window as Window & { PushDocsMonaco?: MonacoApi }).PushDocsMonaco;
    monaco?.editor.getDiffEditors()[0]?.getModifiedEditor().focus();
  });
  await page.keyboard.type("unexpected edit");
  expect(commands).toHaveLength(0);
  expect(
    await page.evaluate(() => {
      const monaco = (window as Window & { PushDocsMonaco?: MonacoApi }).PushDocsMonaco;
      return monaco?.editor.getDiffEditors()[0]?.getModifiedEditor().getValue();
    }),
  ).toBe(after);
  await expect(page.locator(".cursors-layer").first()).toBeHidden();
  await expect(page.locator(".lightBulbWidget")).toHaveCount(0);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() => {
    const monaco = (window as Window & { PushDocsMonaco?: MonacoApi }).PushDocsMonaco;
    if (!monaco) throw new Error("Monaco is missing");
    monaco.editor
      .getDiffEditors()[0]
      ?.getModifiedEditor()
      .setSelection(new monaco.Range(1, 1, 2, 1));
  });
  await page.keyboard.press("ControlOrMeta+c");
  await expect
    .poll(() =>
      page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, "\n")),
    )
    .toBe("first new\n");
});

test("shows the editor action only over changed lines, on the left", async ({ page }) => {
  await setup(page);
  await page.goto(`${fixture.url}/?change-review&revert`);
  await expect(page.getByTestId("monaco-diff")).toBeVisible();
  await expect(page.getByRole("link", { name: "Открыть строку в редакторе" })).toHaveCount(0);
  const actions = await hoverLine(page, 1, false, false);
  const edit = actions.getByRole("link", { name: "Открыть строку в редакторе" });
  await expect(edit).toHaveAttribute(
    "href",
    "/projects/project/documents?branch=docs%2Fupdate&path=content%2Fintro.md&line=1&from=changes",
  );
  const menuBounds = await actions.boundingBox();
  const diffBounds = await page.getByTestId("monaco-diff").boundingBox();
  expect((menuBounds?.x ?? 0) - (diffBounds?.x ?? 0)).toBeLessThan(24);
  const textLeft = await page.evaluate(() => {
    const monaco = (window as Window & { PushDocsMonaco?: MonacoApi }).PushDocsMonaco;
    const editor = monaco?.editor.getDiffEditors()[0]?.getModifiedEditor();
    return (
      (editor?.getDomNode()?.getBoundingClientRect().left ?? 0) +
      (editor?.getScrolledVisiblePosition({ lineNumber: 1, column: 1 })?.left ?? 0)
    );
  });
  expect((menuBounds?.x ?? 0) + (menuBounds?.width ?? 0)).toBeLessThanOrEqual(textLeft);
  await hoverLine(page, 3, false, false);
  await expect(page.getByRole("link", { name: "Открыть строку в редакторе" })).toHaveCount(0);
});

test("restores a pure deletion from the unified diff hover menu", async ({ page, context }) => {
  const { commands } = await setup(page, before);
  await page.goto(`${fixture.url}/?change-review&revert&delete-only`);
  await expect(page.getByTestId("monaco-diff")).toBeVisible();
  await page
    .locator("span.char-delete")
    .filter({ hasText: /^removed$/ })
    .hover();
  await expect(page.locator(".lightbulb-glyph")).toBeHidden();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() => {
    const node = [...document.querySelectorAll("span.char-delete")].find(
      (span) => span.textContent === "removed",
    );
    if (!node?.firstChild) throw new Error("Deleted line is missing");
    const range = document.createRange();
    range.setStart(node.firstChild, 0);
    range.setEnd(node.firstChild, node.textContent?.length ?? 0);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  });
  await page.keyboard.press("ControlOrMeta+c");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("removed");
  await page.getByRole("button", { name: "Откатить фрагмент", exact: true }).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]?.lineIds).toEqual([9]);
});
