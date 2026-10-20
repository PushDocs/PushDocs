import { expect, test } from "@playwright/test";
import type { MonacoApi } from "../../apps/web/src/components/monaco-runtime";
import { startFixtureServer } from "./fixture-server";

let fixture: Awaited<ReturnType<typeof startFixtureServer>>;
test.beforeAll(async () => {
  fixture = await startFixtureServer();
});
test.afterAll(async () => {
  await fixture.close();
});

test("completes folders and files from a Markdown link with the keyboard", async ({ page }) => {
  await page.goto(`${fixture.url}/?path-completions`);
  await expect(page.getByTestId("monaco-source")).toBeVisible();
  await page.evaluate(() => {
    const editor = (
      window as Window & { PushDocsMonaco?: MonacoApi }
    ).PushDocsMonaco?.editor.getEditors()[0];
    const prefix = "![alt](/staticLocalized/ru/img/account-settings";
    editor?.setValue(prefix);
    editor?.setPosition({ lineNumber: 1, column: prefix.length + 1 });
    editor?.focus();
  });
  await page.keyboard.press("/");
  const labels = page.getByRole("listitem", { name: /labels\// });
  await expect(labels).toBeVisible();
  await expect(page.getByRole("listitem", { name: /how-to-enable-2fa\// })).toBeVisible();
  await page.screenshot({
    path: `output/playwright/path-completions-${test.info().project.name}.png`,
  });
  await page.keyboard.type("lab");
  await expect(labels).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("listitem", { name: /one\.png/ })).toBeVisible();
  await page.keyboard.type("two");
  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as Window & { PushDocsMonaco?: MonacoApi }).PushDocsMonaco?.editor
          .getModels()[0]
          ?.getValue(),
      ),
    )
    .toBe("![alt](/staticLocalized/ru/img/account-settings/labels/two.png");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+z");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as Window & { PushDocsMonaco?: MonacoApi }).PushDocsMonaco?.editor
          .getModels()[0]
          ?.getValue(),
      ),
    )
    .not.toContain("two.png");
});

test("invokes relative path suggestions with Ctrl+Space inside an existing link", async ({
  page,
}) => {
  await page.goto(`${fixture.url}/?path-completions`);
  await expect(page.getByTestId("monaco-source")).toBeVisible();
  await page.evaluate(() => {
    const editor = (
      window as Window & { PushDocsMonaco?: MonacoApi }
    ).PushDocsMonaco?.editor.getEditors()[0];
    editor?.setValue('[image](./images/lo.png#part "Title")');
    editor?.setPosition({ lineNumber: 1, column: 19 });
    editor?.focus();
  });
  await page.keyboard.press("Control+Space");
  await expect(page.getByRole("listitem", { name: /local\.png/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as Window & { PushDocsMonaco?: MonacoApi }).PushDocsMonaco?.editor
          .getModels()[0]
          ?.getValue(),
      ),
    )
    .toBe('[image](./images/local.png#part "Title")');
});

test("completes URL-encoded names and quoted paths", async ({ page }) => {
  await page.goto(`${fixture.url}/?path-completions`);
  await expect(page.getByTestId("monaco-source")).toBeVisible();
  for (const [source, prefix, expected] of [
    ["[image](./images/a%20)", "[image](./images/a%20", "[image](./images/a%20file.png)"],
    ['<img src="./images/a " />', '<img src="./images/a ', '<img src="./images/a file.png" />'],
  ]) {
    await page.evaluate(
      ({ source, column }) => {
        const editor = (
          window as Window & { PushDocsMonaco?: MonacoApi }
        ).PushDocsMonaco?.editor.getEditors()[0];
        editor?.setValue(source ?? "");
        editor?.setPosition({ lineNumber: 1, column });
        editor?.focus();
      },
      { source, column: (prefix?.length ?? 0) + 1 },
    );
    await page.keyboard.press("Control+Space");
    await expect(page.getByRole("listitem", { name: /a file\.png/ })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as Window & { PushDocsMonaco?: MonacoApi }).PushDocsMonaco?.editor
            .getModels()[0]
            ?.getValue(),
        ),
      )
      .toBe(expected);
  }
});

for (const [name, prefix, suffix, folder, file] of [
  ["pathname", "![alt](pathname:///img/static-only", ")", "labels", "one.png"],
  ["DocMedia", '<DocMedia\n  alt="alt"\n  src="static-only', '"\n/>', "labels", "one.png"],
  ["Video", '<Video\n  src="/video/forms', '"\n/>', "clips", "demo.mp4"],
]) {
  test(`completes static folders and files in ${name} without inserting the static prefix`, async ({
    page,
  }) => {
    await page.goto(`${fixture.url}/?path-completions`);
    await expect(page.getByTestId("monaco-source")).toBeVisible();
    await page.evaluate(
      ({ prefix, suffix }) => {
        const editor = (
          window as Window & { PushDocsMonaco?: MonacoApi }
        ).PushDocsMonaco?.editor.getEditors()[0];
        editor?.setValue(`${prefix}${suffix}`);
        const lines = prefix.split("\n");
        editor?.setPosition({ lineNumber: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 });
        editor?.focus();
      },
      { prefix: prefix ?? "", suffix: suffix ?? "" },
    );
    await page.keyboard.press("/");
    await expect(page.getByRole("listitem", { name: `${folder}/` })).toBeVisible();
    await page.keyboard.type(folder ?? "");
    await expect(page.getByRole("listitem", { name: `${folder}/` })).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("listitem", { name: file })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as Window & { PushDocsMonaco?: MonacoApi }).PushDocsMonaco?.editor
            .getModels()[0]
            ?.getValue(),
        ),
      )
      .toBe(`${prefix}/${folder}/${file}${suffix}`);
  });
}

test("offers the image root for an empty DocMedia src and localized paths", async ({ page }) => {
  await page.goto(`${fixture.url}/?path-completions`);
  await expect(page.getByTestId("monaco-source")).toBeVisible();
  for (const prefix of ['<DocMedia src="', '<DocMedia src="account-settings/']) {
    await page.evaluate((prefix) => {
      const editor = (
        window as Window & { PushDocsMonaco?: MonacoApi }
      ).PushDocsMonaco?.editor.getEditors()[0];
      editor?.setValue(`${prefix}" />`);
      editor?.setPosition({ lineNumber: 1, column: prefix.length + 1 });
      editor?.focus();
    }, prefix);
    await page.keyboard.press("Control+Space");
    await expect(
      page.getByRole("listitem", { name: prefix.endsWith("/") ? /labels\// : /static-only\// }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
  }
});

test("starts an empty Video src in its configured folder and inserts a public URL", async ({
  page,
}) => {
  await page.goto(`${fixture.url}/?path-completions`);
  await expect(page.getByTestId("monaco-source")).toBeVisible();
  await page.evaluate(() => {
    const editor = (
      window as Window & { PushDocsMonaco?: MonacoApi }
    ).PushDocsMonaco?.editor.getEditors()[0];
    editor?.setValue('<Video src="" />');
    editor?.setPosition({ lineNumber: 1, column: 13 });
    editor?.focus();
  });
  await page.keyboard.press("Control+Space");
  await expect(page.getByRole("listitem", { name: "forms/" })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("listitem", { name: "clips/" })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("listitem", { name: "demo.mp4" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as Window & { PushDocsMonaco?: MonacoApi }).PushDocsMonaco?.editor
          .getModels()[0]
          ?.getValue(),
      ),
    )
    .toBe('<Video src="/video/forms/clips/demo.mp4" />');
});
