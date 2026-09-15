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

test("search modal keeps maximum size across modes and results, highlights matches and scrolls its list", async ({
  page,
}, testInfo) => {
  await page.goto(`${baseURL}/?quickopen`);
  const dialog = page.getByRole("dialog", { name: "Поиск файлов" });
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds?.height).toBe((page.viewportSize()?.height ?? 0) - 40);
  expect(bounds?.width).toBe(Math.min(1200, (page.viewportSize()?.width ?? 0) - 40));
  const search = page.getByRole("searchbox", { name: "Поиск файлов" });
  await page.getByRole("button", { name: "По тексту" }).click();
  expect(await dialog.boundingBox()).toEqual(bounds);
  await search.fill("test");
  await expect(page.getByRole("listitem")).toHaveCount(30);
  expect(await dialog.boundingBox()).toEqual(bounds);
  const marks = page.getByRole("listitem").first().locator("mark");
  await expect(marks).toHaveText(["test", "TEST"]);
  expect(await marks.first().evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    "rgb(255, 240, 163)",
  );
  const results = page.locator(".quick-open-results");
  expect(await results.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("search-highlighted-results.png") });
  await results.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  expect(await results.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await expect(results.locator('.selected, [aria-selected="true"]')).toHaveCount(0);
  await expect(dialog.getByText(/Поиск в импортированных статьях/)).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Закрыть", exact: true })).toHaveText("");
  await search.fill("no matches");
  await expect(page.getByText("Совпадений в статьях не найдено.")).toBeVisible();
  expect(await dialog.boundingBox()).toEqual(bounds);
  await page.getByRole("button", { name: "По названию" }).click();
  expect(await dialog.boundingBox()).toEqual(bounds);
  await search.fill("docs");
  await expect(page.getByRole("listitem")).toHaveCount(0);
  await search.fill("article");
  await expect(page.getByRole("listitem")).toHaveCount(30);
  await expect(results.locator("mark")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("search-empty-fixed-size.png") });
});

test("diff layout is shared across comparisons, reloads and browser tabs", async ({
  page,
  context,
}) => {
  await page.goto(`${baseURL}/?diffs`);
  const split = page.getByRole("button", { name: "Две колонки" });
  await split.first().click();
  await expect(split.nth(0)).toHaveAttribute("aria-pressed", "true");
  await expect(split.nth(1)).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(split.nth(0)).toHaveAttribute("aria-pressed", "true");
  await expect(split.nth(1)).toHaveAttribute("aria-pressed", "true");
  const other = await context.newPage();
  await other.goto(`${baseURL}/?diffs`);
  await expect(other.getByRole("button", { name: "Две колонки" }).first()).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await other.getByRole("button", { name: "Единый" }).first().click();
  await expect(page.getByRole("button", { name: "Единый" }).nth(0)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "Единый" }).nth(1)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await other.close();
});

test("media search focus fits its scroll container and upload row opens file selection", async ({
  page,
}, testInfo) => {
  await page.route("**/api/projects/p/media?*", (route) =>
    route.fulfill({
      json: {
        assets: [
          {
            path: "other/guide.pdf",
            url: "../../other/guide.pdf",
            canDelete: false,
            status: "clean",
            size: null,
            usages: [],
          },
        ],
        revision: 1,
        status: "open",
        role: "editor",
        locale: "ru",
      },
    }),
  );
  await page.goto(`${baseURL}/?media`);
  await expect(page.getByRole("button", { name: "Вставить ссылку" })).toBeEnabled();
  await expect(page.getByText("Вне каталога вложений")).toHaveCount(0);
  await expect(page.getByText("Выбрать файлы")).toHaveCount(0);
  await expect(page.getByText("docs/test-pushdocs", { exact: true })).toHaveCount(0);
  await expect(page.getByText("docs/ecom/ecom-statistics.mdx", { exact: true })).toHaveCount(0);
  const search = page.getByRole("searchbox", { name: "Найти файл" });
  await search.focus();
  await expect(search).toBeFocused();
  const input = await search.boundingBox();
  const refresh = await page.getByRole("button", { name: "Обновить" }).boundingBox();
  const container = await page.getByRole("region", { name: "Медиатека" }).boundingBox();
  expect(input).not.toBeNull();
  expect(refresh).not.toBeNull();
  expect(container).not.toBeNull();
  expect((input?.x ?? 0) - 3).toBeGreaterThanOrEqual(container?.x ?? 0);
  expect((input?.x ?? 0) + (input?.width ?? 0) + 3).toBeLessThanOrEqual(
    (container?.x ?? 0) + (container?.width ?? 0),
  );
  expect(input?.height).toBe(refresh?.height);
  if ((page.viewportSize()?.width ?? 0) > 600) expect(input?.y).toBe(refresh?.y);
  await page.screenshot({ path: testInfo.outputPath("media-search-focus.png") });
  const chooser = page.waitForEvent("filechooser");
  await page.locator("label.media-upload-picker").click();
  expect((await chooser).isMultiple()).toBe(true);
});

test("close icon aligns with the first title line, including wrapped titles", async ({
  page,
}, testInfo) => {
  for (const title of ["Подключение", "Настройки подключения Sendsay для документации проекта"]) {
    await page.goto(`${baseURL}/?title=${encodeURIComponent(title)}`);
    await page.getByText("Открыть форму").click();
    const heading = page.getByRole("heading", { name: title });
    const headingBox = await heading.boundingBox();
    const lineHeight = await heading.evaluate((el) =>
      Number.parseFloat(getComputedStyle(el).lineHeight),
    );
    const close = page.getByRole("button", { name: "Закрыть", exact: true });
    const iconBox = await close.locator("svg").boundingBox();
    expect(headingBox).not.toBeNull();
    expect(iconBox).not.toBeNull();
    expect(
      Math.abs(
        (iconBox?.y ?? 0) + (iconBox?.height ?? 0) / 2 - ((headingBox?.y ?? 0) + lineHeight / 2),
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath(`header-${title === "Подключение" ? "short" : "wrapped"}.png`),
    });
    await close.click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
  }
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
  await expect(page.getByText("Ссылка скопирована", { exact: true })).toHaveCount(0);
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

test("review details keep labels, approval decisions and read-only comments within the viewport", async ({
  page,
}, testInfo) => {
  await page.goto(`${baseURL}/?reviews`);
  await expect(page.getByRole("navigation", { name: "Список MR" })).toContainText(
    "Не готов к слиянию",
  );
  await expect(page.getByRole("region", { name: "Одобрения" })).toContainText(
    "Получено: 1 · Требуется: 2 · Осталось: 1",
  );
  await expect(page.getByRole("region", { name: "Комментарии" })).toContainText(
    "Read-only comment",
  );
  await expect(
    page.locator(
      ".review-information input, .review-information textarea, .review-information button, .review-information a",
    ),
  ).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath("review-information.png"), fullPage: true });
});

test("unread badge updates live, clears when opened and remembers reads across reloads and tabs", async ({
  page,
  context,
}, testInfo) => {
  let comments = [
    { id: "1", body: "Первый", author_name: "Анна", unread: true },
    { id: "2", body: "Мой комментарий", author_name: "Alex", unread: false },
  ];
  await context.route("**/api/projects/project/comments*", async (route) => {
    if (route.request().method() === "PATCH") {
      const ids: string[] = route.request().postDataJSON().commentIds;
      comments = comments.map((comment) =>
        ids.includes(comment.id) ? { ...comment, unread: false } : comment,
      );
      await route.fulfill({ json: { readIds: ids } });
    } else await route.fulfill({ json: comments });
  });
  const event = async (target: typeof page, type = "comment.created") =>
    target.evaluate((eventType) => {
      window.dispatchEvent(
        new CustomEvent("pushdocs:refresh", {
          detail: {
            type: eventType,
            projectId: "project",
            payload: { branch: "main", documentPath: "docs/a.md" },
          },
        }),
      );
    }, type);
  await page.goto(`${baseURL}/?comments`);
  const button = page.getByRole("button", { name: /^Комментарии/ });
  await expect(button.locator(".wb-comment-count")).toHaveText("1");
  comments.push({ id: "3", body: "Новое сообщение", author_name: "Фёдор", unread: true });
  await event(page);
  await expect(button.locator(".wb-comment-count")).toHaveText("2");
  await page.screenshot({ path: testInfo.outputPath("unread-comments.png") });
  await button.click();
  await expect(button.locator(".wb-comment-count")).toHaveCount(0);
  await expect(page.getByText("Новое сообщение")).toBeVisible();
  await page.reload();
  await expect(button).toBeVisible();
  await expect(button.locator(".wb-comment-count")).toHaveCount(0);
  comments.push({ id: "4", body: "Ещё одно сообщение", author_name: "Фёдор", unread: true });
  await event(page);
  await expect(button.locator(".wb-comment-count")).toHaveText("1");
  const second = await context.newPage();
  await second.goto(`${baseURL}/?comments`);
  await second.getByRole("button", { name: /^Комментарии/ }).click();
  await expect(second.locator(".wb-comment-count")).toHaveCount(0);
  await event(page, "comments.read");
  await expect(button.locator(".wb-comment-count")).toHaveCount(0);
  await second.close();
});

test("submission opens from the branch toolbar and blocks duplicate sends while pending", async ({
  page,
}, testInfo) => {
  await page.goto(`${baseURL}/?submit`);
  const trigger = page.getByRole("button", { name: "Отправить изменения", exact: true });
  const edit = page.getByRole("link", { name: "Редактировать ветку" });
  expect(await trigger.evaluate((element) => element.nextElementSibling?.textContent)).toBe(
    "Редактировать ветку",
  );
  await expect(edit).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Отправить изменения" });
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds?.x).toBeGreaterThanOrEqual(0);
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(
    page.viewportSize()?.width ?? 0,
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page
    .getByRole("textbox", { name: "Название MR и сообщение коммита" })
    .fill("Update documentation");
  await page.screenshot({ path: testInfo.outputPath("send-changes-dialog.png") });
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const request = page.waitForRequest("**/fixture-submit");
  await page.route("**/fixture-submit", async (route) => {
    await released;
    await route.fulfill({ status: 204 });
  });
  await page.getByRole("button", { name: "Отправить и создать MR" }).click();
  expect((await request).postDataJSON()).toMatchObject({
    projectId: "project",
    changeSetId: "12345678-rest",
    branch: "stable",
    createReview: "on",
    newBranch: "docs/update-12345678",
    message: "Update documentation",
  });
  await expect(page.getByRole("button", { name: "Отправляем изменения…" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Закрыть", exact: true })).toBeDisabled();
  release();
  await expect(page.getByRole("button", { name: "Отправить и создать MR" })).toBeEnabled();
});

test("failed submission can be retried from the modal without entering another commit message", async ({
  page,
}) => {
  await page.goto(`${baseURL}/?submit&failed`);
  await page.getByRole("button", { name: "Отправить изменения", exact: true }).click();
  const retry = page.getByRole("button", { name: "Проверить результат и повторить" });
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/fixture-retry", async (route) => {
    await released;
    await route.fulfill({ status: 204 });
  });
  const request = page.waitForRequest("**/fixture-retry");
  await retry.click();
  expect((await request).postDataJSON()).toMatchObject({
    projectId: "project",
    changeSetId: "12345678-rest",
    message: "",
  });
  await expect(retry).toBeDisabled();
  await expect(page.getByRole("button", { name: "Закрыть", exact: true })).toBeDisabled();
  release();
  await expect(retry).toBeEnabled();
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("media modal keeps maximum height and packs image actions into its card's bottom right corner", async ({
  page,
}, testInfo) => {
  const paths = [
    "static/favicon.svg",
    "staticLocalized/ru/img/forms/a-long-image-name-that-wraps-over-several-lines.png",
    "other/image.png",
  ];
  const assets = paths.map((path) => ({
    path,
    url: `/${path}`,
    canDelete: true,
    status: "clean",
    size: null,
    usages: [],
  }));
  await page.route("**/api/projects/p/assets?*", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="purple"/></svg>',
    }),
  );
  const commands: Array<{ action: string; path: string; revision: number }> = [];
  await page.route("**/api/projects/p/media*", (route) => {
    if (route.request().method() === "POST") {
      const command = route.request().postDataJSON();
      commands.push(command);
      const asset = assets.find((asset) => asset.path === command.path);
      if (asset) asset.status = command.action === "delete" ? "delete" : "clean";
      return route.fulfill({ json: { saved: true } });
    }
    return route.fulfill({
      json: { assets, revision: 7, role: "editor", status: "open", locale: "ru" },
    });
  });
  await page.goto(`${baseURL}/?media`);
  const dialog = page.getByRole("dialog", { name: "Вложения" });
  await expect(page.locator(".media-card")).toHaveCount(3);
  const bounds = await dialog.boundingBox();
  expect(bounds?.height).toBe((page.viewportSize()?.height ?? 0) - 40);
  const search = page.getByRole("searchbox", { name: "Найти файл" });
  await search.fill("no-match");
  await expect(page.locator(".media-card")).toHaveCount(0);
  expect(await dialog.boundingBox()).toEqual(bounds);
  await search.fill("favicon");
  await expect(page.locator(".media-card")).toHaveCount(1);
  expect(await dialog.boundingBox()).toEqual(bounds);
  await search.fill("");
  for (const card of await page.locator(".media-card").all()) {
    const actions = card.locator(".media-actions");
    const icons = await actions.locator(":scope > *").all();
    expect(icons).toHaveLength(3);
    const boxes = await Promise.all(icons.map((icon) => icon.boundingBox()));
    expect(new Set(boxes.map((box) => box?.y)).size).toBe(1);
    for (const icon of icons) {
      await expect(icon).toHaveText("");
      await expect(icon.locator("svg")).toHaveCount(1);
    }
    const cardBox = await card.boundingBox();
    const actionBox = await actions.boundingBox();
    expect(
      Math.abs(
        (cardBox?.y ?? 0) +
          (cardBox?.height ?? 0) -
          (actionBox?.y ?? 0) -
          (actionBox?.height ?? 0) -
          13,
      ),
    ).toBeLessThan(2);
    expect(boxes.at(-1)?.x).toBeGreaterThan((cardBox?.x ?? 0) + (cardBox?.width ?? 0) / 2);
  }
  await page.screenshot({ path: testInfo.outputPath("media-icon-actions.png") });
  await page.getByRole("button", { name: "Удалить static/favicon.svg", exact: true }).click();
  expect(commands).toHaveLength(0);
  await page.getByRole("button", { name: "Подтвердить удаление" }).click();
  await expect(
    page.getByRole("button", { name: "Отменить удаление static/favicon.svg", exact: true }),
  ).toBeVisible();
  expect(commands[0]).toMatchObject({ action: "delete", path: "static/favicon.svg", revision: 7 });
  expect(await dialog.boundingBox()).toEqual(bounds);
  await page
    .getByRole("button", { name: "Отменить удаление static/favicon.svg", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Удалить static/favicon.svg", exact: true }),
  ).toBeVisible();
  expect(commands[1]).toMatchObject({ action: "revert", path: "static/favicon.svg", revision: 7 });
});
