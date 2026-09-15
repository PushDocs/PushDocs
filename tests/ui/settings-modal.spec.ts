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
  const select = page.getByRole("combobox");
  await select.click();
  const selectBox = await select.boundingBox();
  const popupBox = await page.getByRole("listbox").boundingBox();
  expect(selectBox).not.toBeNull();
  expect(popupBox).not.toBeNull();
  expect(Math.abs((popupBox?.x ?? 0) - (selectBox?.x ?? 0))).toBeLessThanOrEqual(2);
  expect(Math.abs((popupBox?.width ?? 0) - (selectBox?.width ?? 0))).toBeLessThanOrEqual(2);
  const below = (popupBox?.y ?? 0) >= (selectBox?.y ?? 0) + (selectBox?.height ?? 0);
  const above = (popupBox?.y ?? 0) + (popupBox?.height ?? 0) <= (selectBox?.y ?? 0);
  expect(below || above).toBe(true);
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

  const searchRow = await search.locator("..").boundingBox();
  const firstOption = await page.getByRole("option").first().boundingBox();
  expect(searchRow).not.toBeNull();
  expect(firstOption).not.toBeNull();
  expect(
    (firstOption?.y ?? 0) - ((searchRow?.y ?? 0) + (searchRow?.height ?? 0)),
  ).toBeLessThanOrEqual(8);

  const option = page.getByRole("option", { name: "feat/create-translate-script" });
  const beforeHover = await option.evaluate((element) => getComputedStyle(element).backgroundColor);
  await option.hover();
  const afterHover = await option.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(afterHover).not.toBe(beforeHover);
  expect(await option.evaluate((element) => getComputedStyle(element).cursor)).toBe("pointer");
  expect((await option.boundingBox())?.height).toBeLessThanOrEqual(40);

  await search.fill("no-such-branch");
  await expect(page.getByRole("status")).toHaveText("Ничего не найдено");
  await search.fill("");
  await expect(page.getByRole("option").first()).toBeVisible();
  expect(
    await page.getByRole("status").evaluate((element) => element.getBoundingClientRect().height),
  ).toBe(0);
});

test("connection field values are distinct from muted labels and placeholders", async ({
  page,
}, testInfo) => {
  await page.getByText("Открыть форму").click();
  const name = page.getByLabel("Название");
  await expect(name).toHaveValue("Sendsay");
  const colors = await name.evaluate((el) => ({
    value: getComputedStyle(el).color,
    label: getComputedStyle(el.parentElement as HTMLElement).color,
    placeholder: getComputedStyle(el, "::placeholder").color,
  }));
  expect(colors.value).toBe("rgb(37, 38, 49)");
  expect(colors.value).not.toBe(colors.label);
  expect(colors.value).not.toBe(colors.placeholder);
  await page.screenshot({ path: testInfo.outputPath("connection-field-colors.png") });
});

for (const tall of [false, true]) {
  test(`role dropdown is fully visible and clickable in a ${tall ? "scrolling" : "compact"} modal`, async ({
    page,
  }, testInfo) => {
    await page.goto(`${baseURL}/?roles${tall ? "&tall" : ""}`);
    await page.getByText("Открыть форму").click();
    const trigger = page.getByRole("combobox", { name: "Доступ к проекту" });
    await trigger.click();
    const popup = page.getByRole("listbox");
    await expect(popup).toBeVisible();
    for (const label of ["Администратор", "Редактор", "Читатель"]) {
      const option = page.getByRole("option", { name: label, exact: true });
      await expect(option).toBeVisible();
      const exposed = await option.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return [rect.top + 2, rect.bottom - 2].every((y) =>
          element.contains(document.elementFromPoint(rect.x + rect.width / 2, y)),
        );
      });
      expect(exposed, `${label} should not be clipped or covered`).toBe(true);
    }
    await page.screenshot({
      path: testInfo.outputPath(`roles-${tall ? "scrolling" : "compact"}.png`),
    });
    await page.getByRole("option", { name: "Читатель", exact: true }).click();
    await expect(trigger).toContainText("Читатель");
    await expect(popup).not.toBeVisible();
    await trigger.focus();
    await trigger.press("ArrowDown");
    await expect(page.getByRole("option", { name: "Читатель", exact: true })).toBeFocused();
    await page.keyboard.press("Home");
    await page.keyboard.press("Enter");
    await expect(trigger).toContainText("Администратор");
    if (tall) {
      const bounds = await page.getByRole("dialog").boundingBox();
      expect(bounds?.y).toBeGreaterThanOrEqual(0);
      expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(
        page.viewportSize()?.height ?? 0,
      );
    }
  });
}
