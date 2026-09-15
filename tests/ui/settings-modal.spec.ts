import { expect, test } from "@playwright/test";
import { startFixtureServer } from "./fixture-server";

let fixture: Awaited<ReturnType<typeof startFixtureServer>>;
let baseURL: string;
test.beforeAll(async () => {
  fixture = await startFixtureServer();
  baseURL = fixture.url;
});
test.afterAll(async () => {
  await fixture.close();
});
test.beforeEach(async ({ page }) => {
  await page.goto(baseURL);
});
test("select remains interactive inside the modal and close preserves dirty input", async ({
  page,
}, testInfo) => {
  await page.getByText("Открыть форму").click();
  const dialog = page.getByRole("dialog");
  await page.getByLabel("Название").fill("Draft connection");
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: "GitHub" }).click();
  await expect(page.getByRole("combobox")).toContainText("GitHub");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alert")).toContainText("Закрыть без сохранения");
  await page.getByText("Продолжить редактирование").click();
  await expect(page.getByLabel("Название")).toHaveValue("Draft connection");
  await expect(page.getByRole("combobox")).toContainText("GitHub");
  await page.screenshot({ path: testInfo.outputPath("modal.png") });
  const box = await dialog.boundingBox();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.getByText("Закрыть без сохранения", { exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText("Открыть форму")).toBeFocused();
});
test("keeps keyboard focus inside and prevents dismissal while saving", async ({ page }) => {
  await page.getByText("Открыть форму").click();
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest("dialog")))).toBe(
      true,
    );
  }
  await page.getByText("Сохранить", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Закрыть", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("shared controls have styled states and copying reports its result", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => {} } });
  });
  await page.goto(`${baseURL}/?controls`);
  const button = page.getByRole("button", { name: "Изменить доступ" });
  expect(await button.evaluate((el) => getComputedStyle(el).appearance)).toBe("none");
  expect(await button.evaluate((el) => getComputedStyle(el).borderRadius)).toBe("8px");
  const checkbox = page.getByRole("checkbox");
  expect(await checkbox.evaluate((el) => getComputedStyle(el).appearance)).toBe("none");
  await checkbox.check();
  await expect(checkbox).toBeChecked();
  await page.getByLabel("Профиль OpenVPN").setInputFiles({
    name: "company.ovpn",
    mimeType: "text/plain",
    buffer: Buffer.from("fixture"),
  });
  await expect(page.getByText("company.ovpn")).toBeVisible();
  await page.getByRole("button", { name: "Скопировать ссылку" }).click();
  await expect(page.getByRole("status")).toHaveText("Ссылка скопирована");
  await expect(page.getByRole("button", { name: "Скопировано" })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()?.width ?? 0,
  );
  await page.screenshot({ path: testInfo.outputPath("controls.png") });
});

test("branch picker keeps compact rows and shows a pointer hover state", async ({ page }) => {
  await page.goto(`${baseURL}/?branches`);
  const trigger = page.getByRole("combobox", { name: "Текущая ветка" });
  await trigger.click();

  const search = page.getByRole("combobox", { name: "Поиск по веткам" });
  await expect(search).toBeFocused();
  expect(await search.evaluate((element) => getComputedStyle(element).boxShadow)).toBe("none");
  expect(await search.evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe("0px");

  const option = page.getByRole("option", { name: "feat/create-translate-script" });
  const beforeHover = await option.evaluate((element) => getComputedStyle(element).backgroundColor);
  await option.hover();
  const afterHover = await option.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(afterHover).not.toBe(beforeHover);
  expect(await option.evaluate((element) => getComputedStyle(element).cursor)).toBe("pointer");
  expect((await option.boundingBox())?.height).toBeLessThanOrEqual(40);
});
