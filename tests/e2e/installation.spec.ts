// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: Playwright runs directly, outside Turbo.
import { expect, test } from "@playwright/test";

const email = "operator@example.test";
const password = "local-ci-password-123456";

test("operator setup, isolated sessions, login and logout", async ({ page, browser, baseURL }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const restored = process.env.PUSHDOCS_E2E_RESTORED === "1";
  await page.goto("/setup");
  if (restored) {
    await expect(page).toHaveURL(/\/login$/);
  } else {
    await expect(page.getByRole("heading", { name: "Создайте владельца" })).toBeVisible();
    await page.getByLabel("Имя", { exact: true }).fill("CI Operator");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel(/^Пароль/).fill(password);
    await page.getByRole("button", { name: "Создать установку", exact: true }).click();
    await expect(page).toHaveURL(/\/projects$/);
    await page.getByRole("button", { name: "Выйти", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
  }

  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill("incorrect-password");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Email или пароль не подошли." }),
  ).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole("heading", { name: "Проекты", exact: true })).toBeVisible();
  if (restored) await expect(page.getByRole("link", { name: /CI restore fixture/ })).toBeVisible();

  const visitor = await browser.newContext({ baseURL });
  try {
    const anonymous = await visitor.newPage();
    await anonymous.goto("/projects");
    await expect(anonymous).toHaveURL(/\/login$/);
    await anonymous.goto("/setup");
    await expect(anonymous).toHaveURL(/\/login$/);
    await page.reload();
    await expect(page).toHaveURL(/\/projects$/);
  } finally {
    await visitor.close();
  }

  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await page.goto("/projects");
  await expect(page).toHaveURL(/\/login$/);
  expect(errors).toEqual([]);
});
