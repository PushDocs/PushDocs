// @vitest-environment jsdom

import { parseProjectConfig } from "@pushdocs/content";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Workbench, type WorkbenchState } from "./workbench";

const mocks = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks }));
vi.mock("next/link", () => ({ default: (props: Record<string, unknown>) => <a {...props} /> }));
vi.mock("./file-comments", () => ({
  FileComments: ({ path }: { path: string }) => <div>Обсуждение {path}</div>,
}));
let state: WorkbenchState;
let requests: Array<Record<string, unknown>>;
beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  requests = [];
  state = {
    files: [
      {
        path: "docs/a.mdx",
        title: "Первый",
        content: "# Первый\n<Widget />",
        baseContent: "# Первый\n<Widget />",
        locale: "ru",
        version: "current",
        status: "clean",
      },
      {
        path: "docs/b.md",
        title: "Второй",
        content: "# Второй",
        baseContent: "# Второй",
        locale: "en",
        version: "current",
        status: "clean",
      },
      {
        path: "sidebars.js",
        title: "Навигация",
        content: "module.exports = {}",
        baseContent: "module.exports = {}",
        locale: "ru",
        version: "current",
        status: "clean",
      },
    ],
    revision: 0,
    status: "open",
    sha: "12345678",
    branches: [{ full_ref: "main" }, { full_ref: "docs/new" }],
    role: "editor",
    repositoryPaths: [],
    config: parseProjectConfig(),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, options) => {
      if (!options?.body) return Response.json(structuredClone(state));
      const input = JSON.parse(options.body);
      requests.push(input);
      if (input.action === "files") {
        expect(input.expectedRevision).toBe(state.revision);
        for (const change of input.files) {
          const file = state.files.find((item) => item.path === change.path);
          if (file) {
            file.content = change.content ?? "";
            file.status = change.content === null ? "delete" : "modify";
          } else state.files.push({ ...state.files[0], ...change, status: "add" });
        }
        state.revision++;
      }
      return Response.json({ saved: true, name: "docs/new" });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
function mount() {
  render(
    <Workbench
      projectId="project"
      projectName="Docs"
      branch="main"
      initial={structuredClone(state)}
      components={[{ label: "Widget", snippet: '<Widget title="Hi" />' }]}
    />,
  );
}
it("restores open documents independently for each project branch", async () => {
  mount();
  await click("Второй b.md");
  expect(screen.getByLabelText("Исходник документа")).toHaveProperty("value", "# Второй");
  cleanup();
  mount();
  expect(screen.getByLabelText("Исходник документа")).toHaveProperty("value", "# Второй");
  expect(screen.getByRole("tab", { name: "a.mdx" })).toBeTruthy();
  cleanup();
  render(<Workbench projectId="project" projectName="Docs" branch="docs/new" initial={state} />);
  expect(screen.getByLabelText("Исходник документа")).toHaveProperty(
    "value",
    "# Первый\n<Widget />",
  );
});
it("searches branch names and identifies protected branches", async () => {
  state.branches[0] = { full_ref: "main", is_protected: true };
  mount();
  expect(screen.getByRole("option", { name: "main · защищена" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Поиск веток"), { target: { value: "docs/new" } });
  expect(screen.getByRole("option", { name: "docs/new" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Поиск веток"), { target: { value: "missing" } });
  expect(screen.queryByRole("option", { name: "docs/new" })).toBeNull();
});
it("filters versions and changed files and closes tabs after saving", async () => {
  state.files[1] = {
    ...state.files[1],
    version: "1.0",
    status: "modify",
  } as WorkbenchState["files"][number];
  mount();
  fireEvent.change(screen.getByLabelText("Версия документов"), { target: { value: "1.0" } });
  expect(screen.queryByRole("button", { name: "Первый a.mdx" })).toBeNull();
  await click("Второй b.md M");
  fireEvent.change(screen.getByLabelText("Версия документов"), { target: { value: "all" } });
  fireEvent.change(screen.getByLabelText("Статус документов"), { target: { value: "changed" } });
  expect(screen.queryByRole("button", { name: "Первый a.mdx" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Исходник документа"), { target: { value: "# Edited" } });
  await click("Закрыть docs/b.md");
  expect(requests[0]).toMatchObject({ files: [{ path: "docs/b.md", content: "# Edited" }] });
  expect(screen.queryByRole("tab", { name: "b.md" })).toBeNull();
  expect(screen.getByRole("tab", { name: "a.mdx" }).getAttribute("aria-selected")).toBe("true");
  await click("Закрыть docs/a.mdx");
  expect(screen.queryByLabelText("Исходник документа")).toBeNull();
});
it("saves metadata edits through the same optimistic draft operation", async () => {
  state.files[0] = {
    ...state.files[0],
    content: "---\r\ntitle: Old # keep\r\n---\r\n<Widget />",
  } as WorkbenchState["files"][number];
  mount();
  fireEvent.click(screen.getByRole("tab", { name: "Метаданные" }));
  fireEvent.change(screen.getByLabelText("Заголовок"), { target: { value: "New" } });
  await tick();
  expect(requests[0]).toMatchObject({
    files: [{ path: "docs/a.mdx", content: '---\r\ntitle: "New" # keep\r\n---\r\n<Widget />' }],
  });
});
it("closes a background tab without switching the document and keeps an unsaved tab on failure", async () => {
  mount();
  await click("Второй b.md");
  await click("Закрыть docs/a.mdx");
  expect(screen.getByRole("tab", { name: "b.md" }).getAttribute("aria-selected")).toBe("true");
  fireEvent.change(screen.getByLabelText("Исходник документа"), { target: { value: "Unsaved" } });
  vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
  await click("Закрыть docs/b.md");
  expect(screen.getByRole("tab", { name: "b.md" })).toBeTruthy();
  expect(screen.getByLabelText("Исходник документа")).toHaveProperty("value", "Unsaved");
});
it("keeps untouched CRLF endings when editing through a browser textarea", async () => {
  const original = '# Original\r\n\r\n<Widget title="Exact" />\r\n&#x20;\r\n';
  state.files[0] = {
    ...state.files[0],
    content: original,
    baseContent: original,
  } as WorkbenchState["files"][number];
  mount();
  fireEvent.change(screen.getByLabelText("Исходник документа"), {
    target: { value: original.replace(/\r\n/g, "\n").replace("Original", "Changed") },
  });
  await tick();
  expect(requests[0]).toMatchObject({
    files: [{ path: "docs/a.mdx", content: original.replace("Original", "Changed") }],
  });
});
async function click(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}
async function tick(ms = 1200) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

it("keeps MDX bytes on open and filters content and technical files", async () => {
  mount();
  await tick();
  expect(requests).toHaveLength(0);
  expect((screen.getByLabelText("Исходник документа") as HTMLTextAreaElement).value).toBe(
    state.files[0]?.content,
  );
  fireEvent.change(screen.getByLabelText("Поиск по документам и тексту"), {
    target: { value: "Widget" },
  });
  expect(screen.queryByRole("button", { name: /Второй b/ })).toBeNull();
  fireEvent.change(screen.getByLabelText("Поиск по документам и тексту"), {
    target: { value: "" },
  });
  expect(screen.queryByRole("button", { name: /Навигация sidebars/ })).toBeNull();
  fireEvent.click(screen.getByLabelText("Служебные файлы"));
  expect(screen.getByRole("button", { name: /Навигация sidebars/ })).toBeTruthy();
});
it("autosaves once with optimistic revision and preserves component source", async () => {
  mount();
  fireEvent.change(screen.getByLabelText("Исходник документа"), {
    target: { value: "# Изменён\n<Widget />" },
  });
  await tick();
  await tick();
  expect(requests).toHaveLength(1);
  expect(state.files[0]?.content).toBe("# Изменён\n<Widget />");
  expect(screen.getByText("Сохранено в PushDocs")).toBeTruthy();
});
it("saves before switching files and switches comment context", async () => {
  mount();
  fireEvent.change(screen.getByLabelText("Исходник документа"), { target: { value: "правка" } });
  await click("Второй b.md");
  expect(requests).toHaveLength(1);
  expect(screen.getByText("Обсуждение docs/b.md")).toBeTruthy();
  expect((screen.getByLabelText("Исходник документа") as HTMLTextAreaElement).value).toBe(
    "# Второй",
  );
});
it("keeps local text and stops retrying after another editor saves", async () => {
  mount();
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({ error: "Новая ревизия" }, { status: 409 }),
  );
  fireEvent.change(screen.getByLabelText("Исходник документа"), { target: { value: "мой текст" } });
  await tick();
  await click("Второй b.md");
  expect(screen.getByLabelText("Исходник документа")).toHaveProperty("value", "мой текст");
  const current = state.files[0];
  if (!current) throw new Error("Missing fixture");
  current.content = "чужой текст";
  state.revision = 8;
  await click("Перечитать состояние");
  await tick(5000);
  expect(requests).toHaveLength(0);
  expect(screen.getByText("чужой текст")).toBeTruthy();
  await click("Я объединил версии — сохранить");
  expect(requests[0]).toMatchObject({ expectedRevision: 8 });
});
it("does not allow a reader to change files", async () => {
  state.role = "reader";
  mount();
  expect(screen.getByLabelText("Исходник документа")).toHaveProperty("readOnly", true);
  expect(screen.getByRole("button", { name: "Новая ветка" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "Вставить компонент" })).toHaveProperty(
    "disabled",
    true,
  );
  await tick();
  expect(requests).toHaveLength(0);
});
it("creates and moves documents as atomic operations", async () => {
  mount();
  await click("Создать документ");
  fireEvent.change(screen.getByLabelText("Заголовок"), { target: { value: "Новая" } });
  fireEvent.change(screen.getByLabelText("Путь файла"), { target: { value: "docs/new.md" } });
  await click("Применить");
  expect(requests[0]).toMatchObject({ files: [{ path: "docs/new.md", createOnly: true }] });
  await click("Перенести");
  fireEvent.change(screen.getByLabelText("Путь файла"), { target: { value: "docs/moved.md" } });
  await click("Применить");
  expect(requests[1]).toMatchObject({
    files: [
      { path: "docs/new.md", content: null },
      { path: "docs/moved.md", createOnly: true },
    ],
  });
});
it("saves before navigating to changes or another branch", async () => {
  mount();
  fireEvent.change(screen.getByLabelText("Исходник документа"), { target: { value: "черновик" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("link", { name: "К изменениям" }));
  });
  expect(state.files[0]?.content).toBe("черновик");
  expect(mocks.push).toHaveBeenCalledWith("/projects/project/changes?branch=main");
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Ветка"), { target: { value: "docs/new" } });
  });
  expect(mocks.push).toHaveBeenCalledWith("?branch=docs%2Fnew");
});

it("inserts formatting and components without rewriting the rest of MDX", async () => {
  mount();
  const input = screen.getByLabelText("Исходник документа") as HTMLTextAreaElement;
  input.setSelectionRange(2, 8);
  await click("Жирный");
  expect(input.value).toContain("**Первый**");
  for (const name of ["Вставить компонент", "Заголовок", "Таблица", "Примечание"])
    await click(name);
  expect(input.value).toContain('<Widget title="Hi" />');
  expect(input.value).toContain("| Колонка | Колонка |");
  expect(input.value).toContain(":::tip");
  fireEvent.keyDown(input, { key: "Tab" });
  fireEvent.keyDown(input, { key: "s", ctrlKey: true });
  await tick();
  expect(requests.length).toBeGreaterThan(0);
});
it("replaces text with a visible comparison and renders quick Markdown preview", async () => {
  mount();
  fireEvent.change(screen.getByLabelText("Найти текст"), { target: { value: "Первый" } });
  fireEvent.change(screen.getByLabelText("Заменить на"), { target: { value: "Новый" } });
  await click("Заменить и показать изменения");
  expect(screen.getByText("Исходный файл")).toBeTruthy();
  expect(screen.getByText("Ваши изменения")).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "Быстрый просмотр" }));
  expect(screen.getByRole("heading", { name: "Новый" })).toBeTruthy();
});
it("marks a deletion without losing its original source", async () => {
  mount();
  await click("Удалить документ");
  await click("Применить");
  expect(requests[0]).toMatchObject({ files: [{ path: "docs/a.mdx", content: null }] });
  expect(screen.getByText(/Документ будет удалён/)).toBeTruthy();
  await click("Отменить удаление");
  expect(requests[1]).toMatchObject({ files: [{ path: "docs/a.mdx", revert: true }] });
});
it("creates a branch, handles provider errors, and allows closing the dialog", async () => {
  mount();
  await click("Новая ветка");
  fireEvent.change(screen.getByLabelText("Имя ветки"), { target: { value: "docs/new" } });
  await click("Применить");
  expect(requests[0]).toMatchObject({ action: "branch", sha: "12345678", name: "docs/new" });
  await click("Новая ветка");
  vi.mocked(fetch).mockRejectedValueOnce(new Error("Provider offline"));
  await click("Применить");
  expect(screen.getByRole("alert").textContent).toContain("Provider offline");
  await click("Закрыть");
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("traps dialog focus and closes with Escape", async () => {
  mount();
  await click("Создать документ");
  const close = screen.getByRole("button", { name: "Закрыть" });
  expect(document.activeElement).toBe(close);
  fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(screen.getByText("Применить"));
  fireEvent.keyDown(document, { key: "Tab" });
  expect(document.activeElement).toBe(close);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("shows empty states and language filtering", () => {
  mount();
  fireEvent.change(screen.getByLabelText("Язык документов"), { target: { value: "en" } });
  expect(screen.queryByRole("button", { name: "Первый a.mdx" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Поиск по документам и тексту"), {
    target: { value: "nothing" },
  });
  expect(screen.getByText(/Документы не найдены/)).toBeTruthy();
  cleanup();
  state.files = [];
  mount();
  expect(screen.getByText("Выберите или создайте документ")).toBeTruthy();
});
it("previews template files before applying them atomically", async () => {
  state.config.templates = [
    { id: "doc", label: "Документ", path: "docs/{slug}.md", content: "# {title}", companions: [] },
  ];
  mount();
  await click("Создать по шаблону");
  fireEvent.change(screen.getByLabelText("Заголовок"), { target: { value: "Doc" } });
  fireEvent.change(screen.getByLabelText("Имя в URL"), { target: { value: "new" } });
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({
      files: [{ path: "docs/new.md", content: "# Doc" }],
      planDigest: "confirmed-plan",
    }),
  );
  await click("Показать план файлов");
  expect(screen.getByText("План изменений файлов")).toBeTruthy();
  await click("Применить весь план");
  expect(requests[0]).toMatchObject({
    action: "template",
    apply: true,
    planDigest: "confirmed-plan",
    values: { title: "Doc", slug: "new", locale: "ru" },
  });
});
it("retains successful upload links when a later file fails", async () => {
  mount();
  await click("Файлы");
  vi.spyOn(FormData.prototype, "getAll").mockReturnValue([
    new File(["a"], "a.png", { type: "image/png" }),
    new File(["b"], "b.pdf", { type: "application/pdf" }),
  ]);
  const original = vi.mocked(fetch).getMockImplementation();
  let uploads = 0;
  vi.mocked(fetch).mockImplementation(async (url, options) => {
    if (String(url).includes("/assets?")) {
      uploads++;
      return uploads === 1
        ? Response.json({ url: "/img/a.png" })
        : Response.json({ error: "limit" }, { status: 400 });
    }
    if (!original) throw new Error("No fixture");
    return original(url, options);
  });
  await act(async () => {
    fireEvent.submit(screen.getByRole("dialog").querySelector("form") as HTMLFormElement);
  });
  expect(screen.getByLabelText("Исходник документа")).toHaveProperty(
    "value",
    expect.stringContaining("![a.png](/img/a.png)"),
  );
  expect(screen.getByRole("alert").textContent).toContain("b.pdf: limit");
});
it("inserts an existing library image into the editor after refreshing the draft revision", async () => {
  const original = vi.mocked(fetch).getMockImplementation();
  vi.mocked(fetch).mockImplementation(async (url, options) => {
    if (String(url).includes("/media?"))
      return Response.json({
        assets: [
          { path: "static/img/a.png", url: "/img/a.png", status: "clean", size: null, usages: [] },
        ],
        role: "editor",
        revision: 3,
        status: "open",
        locale: "ru",
      });
    if (!original) throw new Error("Missing fixture");
    return original(url, options);
  });
  mount();
  await click("Медиатека");
  vi.mocked(fetch).mockRejectedValueOnce(new Error("Draft refresh failed"));
  await click("Вставить ссылку");
  expect(screen.getByRole("alert").textContent).toContain("Draft refresh failed");
  await click("Вставить ссылку");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByLabelText("Исходник документа")).toHaveProperty(
    "value",
    expect.stringContaining("![a.png](/img/a.png)"),
  );
});
it("keeps the selected document and branch when opening the files section", async () => {
  mount();
  const anchor = document.createElement("a");
  anchor.href = "/projects/project/files";
  document.body.append(anchor);
  await act(async () => {
    fireEvent.click(anchor);
  });
  expect(mocks.push).toHaveBeenCalledWith(
    "/projects/project/files?branch=main&document=docs%2Fa.mdx",
  );
  anchor.remove();
});
it("refreshes a clean editor on events but retains unsaved typing", async () => {
  mount();
  const file = state.files[0];
  if (!file) throw new Error("Missing fixture");
  file.content = "внешняя правка";
  await act(async () => {
    window.dispatchEvent(new Event("pushdocs:refresh"));
  });
  expect(screen.getByLabelText("Исходник документа")).toHaveProperty("value", "внешняя правка");
  fireEvent.change(screen.getByLabelText("Исходник документа"), {
    target: { value: "локальная правка" },
  });
  await act(async () => {
    window.dispatchEvent(new Event("pushdocs:refresh"));
  });
  expect(screen.getByLabelText("Исходник документа")).toHaveProperty("value", "локальная правка");
  expect(screen.getByText(/В ветке появились изменения/)).toBeTruthy();
});
it("polls safely and displays offline state", async () => {
  mount();
  await tick(15000);
  expect(fetch).toHaveBeenCalledTimes(1);
  vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
  await tick(15000);
  expect(screen.getByText(/Нет связи с сервером/)).toBeTruthy();
  await click("Закрыть");
  await click("Обновить");
  expect(requests[0]).toMatchObject({ action: "sync" });
});
it("keeps typing entered while an earlier save is in flight", async () => {
  mount();
  let release: (response: Response) => void = () => undefined;
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  fireEvent.change(screen.getByLabelText("Исходник документа"), { target: { value: "первая" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("link", { name: "К изменениям" }));
  });
  fireEvent.change(screen.getByLabelText("Исходник документа"), { target: { value: "вторая" } });
  await act(async () => {
    release(Response.json({ saved: true }));
  });
  expect(mocks.push).not.toHaveBeenCalled();
  await tick();
  expect(state.files[0]?.content).toBe("вторая");
});

it("protects unload and saves before sidebar and preview navigation", async () => {
  mount();
  const clean = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(clean);
  expect(clean.defaultPrevented).toBe(false);
  fireEvent.change(screen.getByLabelText("Исходник документа"), { target: { value: "черновик" } });
  const dirty = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(dirty);
  expect(dirty.defaultPrevented).toBe(true);
  const anchor = document.createElement("a");
  anchor.href = "/projects/project/members";
  document.body.append(anchor);
  await act(async () => {
    fireEvent.click(anchor);
  });
  expect(mocks.push).toHaveBeenCalledWith("/projects/project/members?branch=main");
  anchor.href = "/projects";
  await act(async () => {
    fireEvent.click(anchor);
  });
  expect(mocks.push).toHaveBeenCalledWith("/projects");
  anchor.remove();
  fireEvent.click(screen.getByText("Документы"), { ctrlKey: true });
  await act(async () => {
    fireEvent.click(screen.getByRole("link", { name: "Открыть сайт" }));
  });
  expect(mocks.push).toHaveBeenCalledWith("/projects/project/preview?branch=main");
});

it("opens document tabs and manually saves a selected component", async () => {
  mount();
  await click("Второй b.md");
  await act(async () => {
    fireEvent.click(screen.getByRole("tab", { name: "a.mdx" }));
  });
  expect(screen.getByLabelText("Исходник документа")).toHaveProperty(
    "value",
    state.files[0]?.content,
  );
  fireEvent.change(screen.getByLabelText("Компонент MDX"), {
    target: { value: '<Widget title="Hi" />' },
  });
  await click("Вставить компонент");
  await click("Сохранить");
  expect(state.files[0]?.content).toContain('<Widget title="Hi" />');
});

it("keeps a failed operation visible and handles failed reload, sync and events", async () => {
  mount();
  await click("Удалить документ");
  vi.mocked(fetch).mockRejectedValueOnce(new Error("mutation failed"));
  await click("Применить");
  expect(screen.getByRole("alert").textContent).toContain("mutation failed");
  await click("Закрыть");
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({ error: "reload failed" }, { status: 500 }),
  );
  await click("Перечитать состояние");
  expect(screen.getByRole("alert").textContent).toContain("reload failed");
  vi.mocked(fetch).mockRejectedValueOnce(new Error("sync failed"));
  await click("Обновить");
  expect(screen.getByRole("alert").textContent).toContain("sync failed");
  vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
  await act(async () => {
    window.dispatchEvent(new Event("pushdocs:refresh"));
  });
  expect(screen.getByText("Нет связи с сервером.")).toBeTruthy();
});

it("keeps a template dialog open when planning fails", async () => {
  state.config.templates = [
    { id: "t", label: "T", path: "docs/{slug}.md", content: "", companions: [] },
  ];
  mount();
  await click("Создать по шаблону");
  vi.mocked(fetch).mockRejectedValueOnce(new Error("template failed"));
  await act(async () => {
    fireEvent.submit(screen.getByRole("dialog").querySelector("form") as HTMLFormElement);
  });
  expect(screen.getByRole("alert").textContent).toContain("template failed");
  expect(screen.getByRole("dialog")).toBeTruthy();
});

it("uploads multiple files to an explicit directory and skips empty selections", async () => {
  mount();
  await click("Файлы");
  fireEvent.change(screen.getByLabelText("Каталог назначения"), {
    target: { value: "static/img/guides/" },
  });
  fireEvent.click(screen.getByLabelText("Заменить существующие файлы с такими же путями"));
  vi.spyOn(FormData.prototype, "getAll").mockReturnValue([
    "skip",
    new File([], "empty"),
    new File(["bytes"], "a.pdf"),
  ]);
  const original = vi.mocked(fetch).getMockImplementation();
  vi.mocked(fetch).mockImplementation(async (url, options) => {
    if (String(url).includes("/assets?")) {
      expect(String(url)).toContain("path=static%2Fimg%2Fguides%2Fa.pdf");
      expect(String(url)).toContain("replace=true");
      return Response.json({ url: "/img/guides/a.pdf" });
    }
    if (!original) throw new Error("No fixture");
    return original(url, options);
  });
  await act(async () => {
    fireEvent.submit(screen.getByRole("dialog").querySelector("form") as HTMLFormElement);
  });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByText(/Загружено файлов: 1/)).toBeTruthy();
  expect(screen.getByLabelText("Исходник документа")).toHaveProperty(
    "value",
    expect.stringContaining("[a.pdf](/img/guides/a.pdf)"),
  );
});

it("creates configuration once and opens it as source for an administrator", async () => {
  state.role = "admin";
  mount();
  await click("Конфигурация проекта");
  expect(requests[0]).toMatchObject({
    files: [{ path: ".pushdocs/config.json", createOnly: true }],
  });
  expect(
    JSON.parse((screen.getByLabelText("Исходник документа") as HTMLTextAreaElement).value),
  ).toEqual(state.config);
  expect(screen.getByLabelText("Служебные файлы")).toHaveProperty("checked", true);
  await click("Второй b.md");
  await click("Конфигурация проекта");
  expect(requests).toHaveLength(1);
});
