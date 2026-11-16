import { expect, test } from "@playwright/test";
import { startFixtureServer } from "./fixture-server";

let fixture: Awaited<ReturnType<typeof startFixtureServer>>;
test.beforeAll(async () => {
  fixture = await startFixtureServer();
});
test.afterAll(async () => {
  await fixture.close();
});

for (const merge of [false, true]) {
  test(`keeps header geometry during ${merge ? "branch merge" : "Git refresh"} and restores loading after navigation`, async ({
    page,
  }, testInfo) => {
    let starts = 0;
    let status = "running";
    await page.route("**/fixture/git/start", async (route) => {
      starts++;
      await route.fulfill({ json: { id: "branch-job" } });
    });
    await page.route("**/fixture/git/status?*", (route) => route.fulfill({ json: { status } }));
    await page.goto(`${fixture.url}/?git-operation${merge ? "&merge" : ""}`);
    const geometry = () =>
      page
        .locator(
          ".wb-header, .wb-actions, .wb-branch-operations > button, .live-preview-start, .wb-primary",
        )
        .evaluateAll((elements) =>
          elements.map((element) => {
            const { x, y, width, height } = element.getBoundingClientRect();
            return { x, y, width, height };
          }),
        );
    const before = await geometry();
    if (merge) {
      await page.getByText("Влить stable…").click();
      await page.getByRole("button", { name: "Влить в docs/task" }).click();
    } else {
      await page.getByRole("button", { name: "Обновить из Git", exact: true }).click();
    }
    await expect(page.getByRole("button", { name: "Обновляем ветку…" })).toBeDisabled();
    expect(await geometry()).toEqual(before);
    await page.screenshot({ path: testInfo.outputPath("header-loading.png") });
    await page.getByRole("button", { name: "Другой раздел" }).click();
    await page.getByRole("button", { name: "Документы", exact: true }).click();
    await expect(page.getByRole("button", { name: "Обновляем ветку…" })).toBeDisabled();
    expect(await geometry()).toEqual(before);
    expect(starts).toBe(1);

    status = "done";
    await expect(page.getByRole("button", { name: "Обновить из Git", exact: true })).toBeEnabled();
    await expect(page.getByRole("status")).toContainText(merge ? "влита" : "обновлена");
    expect(await geometry()).toEqual(before);
    await page.getByRole("button", { name: "Закрыть уведомление" }).click();
    await expect(page.getByRole("status")).toHaveCount(0);
    expect(await geometry()).toEqual(before);
  });
}

test("restores MR refresh after leaving while its start request is pending", async ({ page }) => {
  let starts = 0;
  let startResponse: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => (startResponse = resolve));
  let status = "running";
  await page.route("**/fixture/git/start", async (route) => {
    starts++;
    await pending;
    await route.fulfill({ json: { id: "reviews-job" } });
  });
  await page.route("**/fixture/git/status?*", (route) => route.fulfill({ json: { status } }));
  await page.goto(`${fixture.url}/?git-operation`);
  await page.getByRole("button", { name: "MR", exact: true }).click();
  const before = await page.getByRole("button", { name: "Обновить данные MR" }).boundingBox();
  await page.getByRole("button", { name: "Обновить данные MR" }).click();
  await expect.poll(() => starts).toBe(1);
  await page.getByRole("button", { name: "Другой раздел" }).click();
  startResponse?.();
  await page.getByRole("button", { name: "MR", exact: true }).click();
  await expect(page.getByRole("button", { name: "Обновляем MR…" })).toBeDisabled();
  expect(await page.getByRole("button", { name: "Обновляем MR…" }).boundingBox()).toEqual(before);
  status = "done";
  await expect(page.getByRole("status")).toHaveText("Состояние MR обновлено");
  expect(starts).toBe(1);
});

for (const reason of ["need_rebase", "conflict"]) {
  test(`places a compact ${reason} notice in the MR header`, async ({ page }, testInfo) => {
    await page.goto(`${fixture.url}/?reviews&update=${reason}`);
    const notice = page.locator(".review-heading").getByRole("region", { name: "Состояние ветки" });
    const link = notice.getByRole("link", { name: "Перейти к изменениям" });
    await expect(link).toHaveAttribute("href", /\/projects\/project\/changes\?branch=docs%2F/);
    await expect(notice).toContainText(reason === "conflict" ? "конфликтует" : "отстаёт");
    await expect(page.getByRole("region", { name: "Готовность к слиянию" })).toHaveCount(0);
    await expect(page.locator(".review-conflict-files")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Обновить ветку", exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      await page.evaluate(() => window.innerWidth),
    );
    if (testInfo.project.name === "desktop") {
      const text = await notice.locator("strong").boundingBox();
      const action = await link.boundingBox();
      expect(text?.y).toBe(action?.y);
    }
    await page.screenshot({ path: testInfo.outputPath(`mr-${reason}.png`), fullPage: true });
  });
}

for (const reason of ["need_rebase", "conflict"]) {
  test(`shows current changes before the ${reason} action`, async ({ page }, testInfo) => {
    const url = `${fixture.url}/?reviews&update=${reason}&changes`;
    await page.goto(`${url}&pending`);
    await expect(
      page.getByRole("heading", { name: "Сначала завершите текущие правки" }),
    ).toBeVisible();
    await expect(page.locator(".branch-notice")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Обновить ветку", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Разрешить конфликты" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      await page.evaluate(() => window.innerWidth),
    );
    await page.screenshot({ path: testInfo.outputPath(`pending-${reason}.png`), fullPage: true });

    await page.goto(url);
    await expect(page.locator(".branch-notice")).toHaveCount(1);
    await expect(
      page.getByRole("heading", { name: "Сначала завершите текущие правки" }),
    ).toHaveCount(0);
    if (reason === "conflict") {
      await expect(page.getByRole("link", { name: "Разрешить конфликты" })).toBeVisible();
    } else {
      await expect(page.getByRole("button", { name: "Обновить ветку", exact: true })).toBeEnabled();
    }
  });
}

test("updates the branch from Changes without horizontal overflow", async ({ page }, testInfo) => {
  await page.goto(`${fixture.url}/?reviews&update=need_rebase&changes`);
  const notice = page.getByRole("region", { name: "Обновление ветки" });
  await expect(notice.getByRole("button", { name: "Обновить ветку", exact: true })).toBeEnabled();
  await expect(notice.getByRole("link", { name: "Открыть MR в GitLab" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth),
  );
  await page.screenshot({ path: testInfo.outputPath("branch-update.png"), fullPage: true });
  let request: unknown;
  let status = "running";
  await page.route("**/fixture/git/start", async (route) => {
    request = route.request().postDataJSON();
    await route.fulfill({ json: { id: "update-job" } });
  });
  await page.route("**/fixture/git/status?*", (route) => route.fulfill({ json: { status } }));
  await notice.getByRole("button", { name: "Обновить ветку", exact: true }).click();
  await expect(notice).toContainText("SHA изменятся");
  expect(request).toBeUndefined();
  await notice.getByRole("button", { name: "Обновить и отправить в Git" }).click();
  await expect(notice.getByRole("button", { name: "Обновляем ветку…" })).toBeDisabled();
  await expect
    .poll(() => request)
    .toMatchObject({
      projectId: "project",
      updateReview: { reviewId: "review-7", expectedHeadSha: "sha" },
    });
  status = "done";
  await expect(notice.getByRole("status")).toContainText("Ветка обновлена и отправлена в Git");
});

test("separates the current branch's MR above the list and omits its switch action", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => sessionStorage.setItem("pushdocs:branch:project", "docs/update"));
  await page.goto(`${fixture.url}/?reviews`);
  const list = page.getByRole("navigation", { name: "Список MR" });
  const current = list.getByRole("region", { name: "MR текущей ветки" });
  await expect(current.getByRole("heading", { name: "Текущая ветка" })).toBeVisible();
  await expect(current).toContainText("Нужны одобрения");
  await expect(current.getByRole("link")).toHaveCount(1);
  await expect(list.getByRole("link")).toHaveCount(2);
  await expect(list.getByRole("link").first()).toContainText("Update documentation");
  await expect(page.getByRole("link", { name: "Переключиться на ветку" })).toHaveCount(0);
  await expect(page.locator(".review-current-branch")).toHaveCount(0);
  const currentBox = await current.boundingBox();
  const otherBox = await list.getByRole("link", { name: /^Other documentation/ }).boundingBox();
  expect(currentBox).not.toBeNull();
  expect(otherBox).not.toBeNull();
  expect((currentBox?.y ?? 0) + (currentBox?.height ?? 0)).toBeLessThan(otherBox?.y ?? 0);
  await expect(page.getByRole("note")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("current-branch.png"), fullPage: true });
  await page.evaluate(() => {
    sessionStorage.setItem("pushdocs:branch:project", "docs/other");
    window.dispatchEvent(new Event("pushdocs:context"));
  });
  await expect(current.getByRole("link")).toContainText("Other documentation");
  await expect(list.getByRole("link")).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "Update documentation" })).toBeVisible();
});

test("quietly shows a missing MR for a long current branch without overflow", async ({
  page,
}, testInfo) => {
  const branch = `docs/${"new-branch-name-".repeat(12)}#1`;
  await page.addInitScript(
    (value) => sessionStorage.setItem("pushdocs:branch:project", value),
    branch,
  );
  await page.goto(`${fixture.url}/?reviews`);
  const notice = page.getByRole("note", { name: "MR текущей ветки" });
  await expect(notice).toContainText(branch);
  await expect(notice).toContainText("нет открытого MR");
  await expect(notice.getByRole("link", { name: "К изменениям" })).toHaveAttribute(
    "href",
    `/projects/project/changes?${new URLSearchParams({ branch })}`,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth),
  );
  await page.screenshot({
    path: testInfo.outputPath("missing-current-branch-mr.png"),
    fullPage: true,
  });
  await page.evaluate(() => {
    sessionStorage.setItem("pushdocs:branch:project", "docs/update");
    window.dispatchEvent(new Event("pushdocs:context"));
  });
  await expect(notice).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "MR текущей ветки" }).getByRole("link"),
  ).toContainText("Update documentation");
});

test("uses a quiet Changes indicator while editing documents", async ({ page }, testInfo) => {
  await page.addInitScript(() => sessionStorage.setItem("pushdocs:branch:project", "docs/task"));
  await page.goto(`${fixture.url}/projects/project/documents?branch-attention`);
  const dot = page.getByRole("img", { name: "Ветка требует внимания" });
  await expect(dot).toBeVisible();
  await expect(dot.locator("..")).toHaveAttribute(
    "href",
    "/projects/project/changes?branch=docs%2Ftask",
  );
  await expect(page.locator(".branch-conflict-notice, .branch-update-notice")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("document-attention.png"), fullPage: true });
});
