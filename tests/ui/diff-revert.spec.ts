import { expect, type Page, test } from "@playwright/test";
import { build } from "esbuild";
import type { MonacoApi } from "../../apps/web/src/components/monaco-runtime";
import type { RevertEdit } from "../../apps/web/src/lib/diff-revert-state";

let runtime: typeof import("./diff-revert-runtime");

import { logicalLineDiff, wrappedDeletionDiff } from "./diff-revert-fixtures";
import { startFixtureServer } from "./fixture-server";

const before =
  "first old\nsecond old\nkeep 1\nkeep 2\nkeep 3\nkeep 4\nkeep 5\nkeep 6\nlast old\nremoved\nend\n";
const after =
  "first new\nsecond new\nkeep 1\nkeep 2\nkeep 3\nkeep 4\nkeep 5\nkeep 6\nlast new\nend\n";
let fixture: Awaited<ReturnType<typeof startFixtureServer>>;
test.beforeAll(async () => {
  fixture = await startFixtureServer();
  const bundle = await build({
    entryPoints: ["tests/ui/diff-revert-runtime.ts"],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    alias: { "@/components/text-diff": "./apps/web/src/components/text-diff.ts" },
  });
  runtime = await import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]?.text ?? "").toString("base64")}`
  );
});
test.afterAll(async () => {
  await fixture.close();
});
async function setup(page: Page, base = before, initial = after) {
  const { buildTextDiff, revertDiffLines, applyRevertEdits, revertEdits } = runtime;
  const state = { content: initial, revision: 7 };
  const snapshots = new Map<string, { after: string; blocks: RevertEdit[] }>();
  const commands: {
    lineIds?: number[];
    restoreToken?: string;
    restoreBlocks?: number[];
    expectedRevision: number;
  }[] = [];
  await page.route("**/api/projects/project/changes", async (route) => {
    const command = route.request().postDataJSON();
    commands.push(command);
    expect(command.expectedRevision).toBe(state.revision);
    if (command.restoreToken) {
      const snapshot = snapshots.get(command.restoreToken);
      if (!snapshot) throw new Error("Unknown snapshot");
      state.content =
        applyRevertEdits(
          snapshot.after,
          state.content,
          true,
          (command.restoreBlocks ?? snapshot.blocks.map((_, i) => i)).map(
            (i: number) => snapshot.blocks[i] as RevertEdit,
          ),
        ) ?? "";
      state.revision++;
      await route.fulfill({ json: state });
      return;
    }
    const diff = buildTextDiff(base, state.content);
    if (!diff) throw new Error("No diff");
    const ids =
      command.lineIds ??
      diff.lines.filter((line) => line.kind !== "context").map((line) => line.id);
    const content = revertDiffLines(base, state.content, ids);
    const blocks = revertEdits(diff.lines, ids);
    const undoToken = `undo-${state.revision}`;
    snapshots.set(undoToken, { after: content, blocks });
    state.content = content;
    state.revision++;
    await route.fulfill({
      json: {
        ...state,
        undoToken,
        undoHeadSha: "head",
        undoBlocks: blocks.map(({ start, end }, index) => ({ start, end, index })),
      },
    });
  });
  await page.route("**/fixture-changes", (route) => route.fulfill({ json: state }));
  return { state, commands };
}
async function hoverLine(page: Page, line: number, fallback = false, split = false) {
  if (fallback) {
    const row = page.locator(
      `${split ? ".wb-diff-pair" : ".wb-diff-row"}[data-new-number="${line}"]`,
    );
    await row.locator(".wb-diff-text").last().hover();
    return row.locator("..").getByRole("group", { name: "Действия со строкой" });
  }
  await expect
    .poll(() =>
      page.evaluate(() => {
        const monaco = (window as Window & { PushDocsMonaco?: MonacoApi }).PushDocsMonaco;
        const diff = monaco?.editor.getDiffEditors()[0];
        return !!diff && diff.getLineChanges() !== null;
      }),
    )
    .toBe(true);
  const text = await page.evaluate((line) => {
    const monaco = (window as Window & { PushDocsMonaco?: MonacoApi }).PushDocsMonaco;
    const side = monaco?.editor.getDiffEditors()[0]?.getModifiedEditor();
    return side?.getModel()?.getLineContent(line) ?? "";
  }, line);
  await page
    .locator(".view-lines .view-line")
    .filter({ hasText: text })
    .last()
    .locator("span")
    .last()
    .hover();
  return page.locator(".wb-diff-hover-actions").getByRole("group", { name: "Действия со строкой" });
}
async function confirm(page: Page) {
  await page.getByRole("button", { name: "Подтвердить откат" }).click();
  await expect(page.getByRole("dialog", { name: "Подтверждение отката" })).toHaveCount(0);
}
async function undoGray(page: Page, line: number, fallback: boolean) {
  if (fallback) {
    const row = page.locator(`[data-new-number="${line}"]`).last();
    await row.locator(".wb-diff-text").last().hover();
    await row.locator("..").getByRole("button", { name: "Вернуть изменения" }).click();
  } else {
    await hoverLine(page, line);
    await page
      .locator(".wb-diff-hover-actions")
      .getByRole("button", { name: "Вернуть изменения" })
      .click();
  }
}
for (const fallback of [false, true])
  for (const split of [false, true]) {
    test(`${fallback ? "fallback" : "Monaco"} ${split ? "split" : "unified"}: one action per logical change; gray block undo preserves its neighbor`, async ({
      page,
    }, info) => {
      if (fallback) await page.route("**/monaco/**", (route) => route.abort());
      const { state, commands } = await setup(page);
      await page.goto(`${fixture.url}/?change-review&revert`);
      if (!fallback) await expect(page.getByTestId("monaco-diff")).toBeVisible();
      if (split) await page.getByRole("button", { name: "Две колонки" }).click();
      for (const line of [1, 2]) {
        const actions = await hoverLine(page, line, fallback, split);
        await expect(actions.getByRole("button")).toHaveCount(1);
        const diff = page.getByRole("region", { name: "Сравнение изменений", exact: true });
        const bounds = await diff.boundingBox();
        await actions.getByRole("button").click();
        const popup = page.getByRole("dialog", { name: "Подтверждение отката" });
        await expect(popup).toBeVisible();
        expect(await popup.textContent()).not.toContain("content/intro.md");
        expect((await popup.boundingBox())?.width).toBeLessThanOrEqual(300);
        expect(await diff.boundingBox()).toEqual(bounds);
        expect(commands).toHaveLength(line - 1);
        await confirm(page);
        await expect.poll(() => state.revision).toBe(7 + line);
      }
      expect(commands[0]?.lineIds).toEqual([0, 2]);
      expect(state.content).toBe(after.replace("first new\nsecond new", "first old\nsecond old"));
      await undoGray(page, 1, fallback);
      await expect.poll(() => state.content).toBe(after.replace("second new", "second old"));
      expect(commands[2]?.expectedRevision).toBe(9);
      await page.screenshot({ path: info.outputPath("gray-blocks.png"), fullPage: true });
    });
    test(`${fallback ? "fallback" : "Monaco"} ${split ? "split" : "unified"}: full rollback keeps gray blocks, permits partial undo and clears them on reload`, async ({
      page,
    }) => {
      if (fallback) await page.route("**/monaco/**", (route) => route.abort());
      const { state } = await setup(page);
      await page.goto(`${fixture.url}/?change-review&revert`);
      if (!fallback) await expect(page.getByTestId("monaco-diff")).toBeVisible();
      if (split) await page.getByRole("button", { name: "Две колонки" }).click();
      await page.getByRole("button", { name: "Откатить изменения", exact: true }).click();
      await page.getByRole("button", { name: "Откатить файл", exact: true }).click();
      await expect.poll(() => state.content).toBe(before);
      await expect(
        page.getByRole("region", { name: "Сравнение изменений", exact: true }),
      ).toBeVisible();
      await expect(page.locator(".change-undo-notice")).toHaveCount(0);
      await undoGray(page, 1, fallback);
      await expect
        .poll(() => state.content)
        .toBe(before.replace("first old\nsecond old", "first new\nsecond new"));
      await page.reload();
      await expect(
        page.getByRole("region", { name: "Сравнение изменений", exact: true }),
      ).toBeVisible();
      await expect(
        page.locator(".wb-diff-reverted-line, .wb-diff-reverted-block, .wb-diff-reverted-empty"),
      ).toHaveCount(0);
    });
  }
test("deleted wrapped paragraph: one logical target, anchored at its top next to the text", async ({
  page,
}, info) => {
  const { commands } = await setup(page, wrappedDeletionDiff.before, wrappedDeletionDiff.after);
  await page.goto(`${fixture.url}/?change-review&revert&wrapped-deletion`);
  await expect(page.getByTestId("monaco-diff")).toBeVisible();
  const rows = page.locator(".view-zones .line-delete .view-line");
  await expect(rows.first()).toBeVisible();
  const paragraph = rows.filter({ hasText: /\S/ });
  const first = await paragraph.first().boundingBox();
  if (!first) throw new Error("No paragraph");
  let top: number | undefined;
  for (const row of await paragraph.all()) {
    const bounds = await row.boundingBox();
    if (!bounds) throw new Error("No row");
    await page.mouse.move(bounds.x + 20, bounds.y + 10);
    const actions = page.locator(".wb-diff-hover-actions");
    await expect(actions.getByRole("button")).toHaveCount(1);
    const menu = await actions.boundingBox();
    expect(Math.abs((menu?.y ?? 0) - first.y)).toBeLessThan(2);
    expect((menu?.x ?? 0) + (menu?.width ?? 0)).toBeLessThanOrEqual(first.x);
    expect(first.x - ((menu?.x ?? 0) + (menu?.width ?? 0))).toBeLessThan(8);
    if (top !== undefined) expect(menu?.y).toBe(top);
    top = menu?.y;
  }
  await page.screenshot({ path: info.outputPath("deleted-menu-position.png"), fullPage: true });
  await page.locator(".wb-diff-hover-actions").getByRole("button").click();
  await confirm(page);
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]?.lineIds).toEqual([10]);
});
test("added logical line 34 reverts independently of replacement 33 and leaves an undoable gray marker", async ({
  page,
}, info) => {
  const { state, commands } = await setup(page, logicalLineDiff.before, logicalLineDiff.after);
  await page.goto(`${fixture.url}/?change-review&revert&logical-lines`);
  await expect(page.getByTestId("monaco-diff")).toBeVisible();
  const actions = await hoverLine(page, 34);
  await expect(actions.getByRole("button")).toHaveCount(1);
  await actions.getByRole("button").click();
  await confirm(page);
  await expect.poll(() => state.content).toBe(logicalLineDiff.after.replace("ававаы\n", ""));
  expect(commands[0]?.lineIds).toEqual([34]);
  const marker = page.locator(".wb-diff-reverted-empty");
  await expect(marker).toBeVisible();
  await marker.hover();
  const restoreButton = page
    .locator(".wb-diff-hover-actions")
    .getByRole("button", { name: "Вернуть изменения" });
  await expect(restoreButton).toBeVisible();
  await expect(restoreButton.locator("svg")).toHaveClass(/lucide-redo/);
  await page.screenshot({ path: info.outputPath("restore-deleted-lines.png"), fullPage: true });
  await page
    .locator(".wb-diff-hover-actions")
    .getByRole("button", { name: "Вернуть изменения" })
    .click();
  await expect.poll(() => state.content).toBe(logicalLineDiff.after);
  await expect(page.locator(".wb-diff-reverted-empty")).toHaveCount(0);
  const deletedRows = page.locator(".view-zones .line-delete .view-line");
  await expect(deletedRows.first()).toBeVisible();
  for (const row of await deletedRows.all()) {
    const bounds = await row.boundingBox();
    if (!bounds) throw new Error("No deleted row");
    await page.mouse.move(bounds.x + 20, bounds.y + 10);
    await expect(page.locator(".wb-diff-hover-actions").getByRole("button")).toHaveCount(1);
  }
  await page.locator(".wb-diff-hover-actions").getByRole("button").click();
  await confirm(page);
  await expect
    .poll(() => state.content)
    .toBe(logicalLineDiff.before.replace("\n\nКонец", "\nававаы\n\nКонец"));
  expect(commands[2]?.lineIds).toEqual([32, 33]);
});
test("confirmation can be dismissed and Ctrl+Z restores the latest operation", async ({ page }) => {
  const { state, commands } = await setup(page);
  await page.goto(`${fixture.url}/?change-review&revert`);
  await expect(page.getByTestId("monaco-diff")).toBeVisible();
  let actions = await hoverLine(page, 1);
  await actions.getByRole("button").click();
  await page.keyboard.press("Escape");
  expect(commands).toHaveLength(0);
  actions = await hoverLine(page, 1);
  await actions.getByRole("button").click();
  await confirm(page);
  await expect.poll(() => state.revision).toBe(8);
  await expect(page.getByRole("dialog", { name: "Подтверждение отката" })).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => state.content).toBe(after);
});
