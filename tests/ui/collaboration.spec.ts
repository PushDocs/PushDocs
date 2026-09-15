import { expect, type Page, test } from "@playwright/test";
import { startFixtureServer } from "./fixture-server";

let server: Awaited<ReturnType<typeof startFixtureServer>>;
test.beforeEach(async () => {
  server = await startFixtureServer();
});
test.afterEach(async () => {
  await server.close();
});
async function content(page: Page) {
  return page.evaluate(() => {
    const monaco = (
      window as Window & {
        PushDocsMonaco?: { editor: { getModels: () => Array<{ getValue: () => string }> } };
      }
    ).PushDocsMonaco;
    return (
      monaco?.editor.getModels()[0]?.getValue() ??
      (document.querySelector("textarea") as HTMLTextAreaElement | null)?.value
    );
  });
}
for (const fallback of [false, true]) {
  test(`two ${fallback ? "fallback" : "Monaco"} editors converge, undo preserves remote edits, offline work survives reload`, async ({
    browser,
  }) => {
    const viewport = test.info().project.use.viewport;
    const aliceContext = await browser.newContext({ viewport });
    const bobContext = await browser.newContext({ viewport });
    if (fallback) {
      await aliceContext.route("**/monaco/**", (route) => route.abort());
      await bobContext.route("**/monaco/**", (route) => route.abort());
    }
    const alice = await aliceContext.newPage();
    const bob = await bobContext.newPage();
    await Promise.all([
      alice.goto(`${server.url}/?collaboration`),
      bob.goto(`${server.url}/?collaboration`),
    ]);
    await expect(alice.getByRole("status")).toHaveText("Сохранено");
    await expect(bob.getByRole("status")).toHaveText("Сохранено");
    const aliceEditor = fallback
      ? alice.getByRole("textbox", { name: "Исходник документа" })
      : alice.getByTestId("monaco-source");
    const bobEditor = fallback
      ? bob.getByRole("textbox", { name: "Исходник документа" })
      : bob.getByTestId("monaco-source");
    await expect(aliceEditor).toBeVisible();
    await expect(bobEditor).toBeVisible();
    await aliceEditor.click();
    for (let i = 0; i < 20; i++) await alice.keyboard.press("ArrowLeft");
    await alice.keyboard.type("X");
    await bobEditor.click();
    for (let i = 0; i < 20; i++) await bob.keyboard.press("ArrowRight");
    await bob.keyboard.type("Y");
    await expect.poll(() => content(alice)).toBe("XabcY");
    await expect.poll(() => content(bob)).toBe("XabcY");
    await alice.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => content(bob)).toBe("abcY");
    await aliceContext.setOffline(true);
    for (let i = 0; i < 20; i++) await alice.keyboard.press("ArrowLeft");
    await alice.keyboard.type("offline-");
    await expect(alice.getByRole("status")).toHaveText("Нет связи");
    for (let i = 0; i < 20; i++) await bob.keyboard.press("ArrowRight");
    await bob.keyboard.type("!");
    await expect(bob.getByRole("status")).toHaveText("Сохранено");
    await aliceContext.setOffline(false);
    await alice.reload();
    await expect.poll(() => content(alice)).toBe("offline-abcY!");
    await expect.poll(() => content(bob)).toBe("offline-abcY!");
    await aliceContext.close();
    await bobContext.close();
  });
}
