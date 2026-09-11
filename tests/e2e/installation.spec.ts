// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: Playwright runs directly, outside Turbo.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { totpCode } from "../../packages/db/src/totp";

const email = "operator@example.test";
const password = "local-ci-password-123456";

test("operator setup, isolated sessions, login and logout", async ({ page, browser, baseURL }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const restored = process.env.PUSHDOCS_E2E_RESTORED === "1";
  let secret = restored ? await readFile("output/ci/totp-fixture", "utf8") : "";
  await page.goto("/setup");
  if (restored) {
    await expect(page).toHaveURL(/\/login$/);
  } else {
    await expect(page.getByRole("heading", { name: "Создайте владельца" })).toBeVisible();
    await page.getByLabel("Имя", { exact: true }).fill("CI Operator");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel(/^Пароль/).fill(password);
    await page.getByRole("button", { name: "Создать установку", exact: true }).click();
    await expect(page).toHaveURL(/\/two-factor$/);
    secret = await page.getByLabel("Ключ для ручного ввода").inputValue();
    await mkdir("output/ci", { recursive: true });
    await writeFile("output/ci/totp-fixture", secret, { mode: 0o600 });
    await page.goto("/projects");
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/two-factor");
    await page.getByLabel("Код 2FA", { exact: true }).fill(totpCode(secret, Date.now()));
    await page.getByRole("button", { name: "Включить 2FA", exact: true }).click();
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
  await expect(page).toHaveURL(/\/two-factor$/);
  // Setup consumed the current interval. Use the next interval when it starts.
  const counter = Math.floor(Date.now() / 30_000);
  await expect
    .poll(() => Math.floor(Date.now() / 30_000), { timeout: 35_000 })
    .toBeGreaterThan(counter);
  await page.getByLabel("Код 2FA", { exact: true }).fill(totpCode(secret, Date.now()));
  await page.getByRole("button", { name: "Подтвердить вход", exact: true }).click();
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
