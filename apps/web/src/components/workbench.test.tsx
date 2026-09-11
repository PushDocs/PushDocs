// @vitest-environment jsdom

import { parseProjectConfig } from "@pushdocs/content";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { draftKey, readDraft, writeDraft } from "./draft-storage";
import { Workbench, type WorkbenchState } from "./workbench";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  start: vi.fn(),
  status: vi.fn(),
}));
vi.mock("@/app/actions", () => ({
  startGitOperationAction: mocks.start,
  gitOperationStatusAction: mocks.status,
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks }));
vi.mock("next/link", () => ({ default: (props: Record<string, unknown>) => <a {...props} /> }));
vi.mock("@pushdocs/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pushdocs/ui")>();
  return {
    ...actual,
    Select: ({
      defaultValue,
      disabled,
      id,
      label,
      name,
      onValueChange,
      options,
      required,
      value,
    }: {
      defaultValue?: string;
      disabled?: boolean;
      id?: string;
      label: string;
      name?: string;
      onValueChange?: (value: string) => void;
      options: Array<{ label: string; value: string }>;
      required?: boolean;
      value?: string;
    }) => (
      <select
        aria-label={label}
        defaultValue={defaultValue}
        disabled={disabled}
        id={id}
        name={name}
        onChange={(event) => onValueChange?.(event.target.value)}
        required={required}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    ),
  };
});
vi.mock("./file-comments", () => ({
  FileComments: ({ path }: { path: string }) => <div>Обсуждение {path}</div>,
}));
let state: WorkbenchState;
let requests: Array<Record<string, unknown>>;
beforeEach(() => {
  vi.useFakeTimers();
  mocks.start.mockResolvedValue("job");
  mocks.status.mockResolvedValue({ status: "done" });
  sessionStorage.clear();
  localStorage.clear();
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
      if (input.action === "folder") {
        state.files.push({
          ...state.files[0],
          title: "New",
          baseContent: "",
          locale: "ru",
          version: "current",
          path: `${input.path}/.gitkeep`,
          content: "",
          status: "add",
        });
        state.revision++;
      }
      if (input.action === "template" && input.apply) {
        state.files.push({
          ...state.files[0],
          title: "New",
          baseContent: "",
          locale: "ru",
          version: "current",
          path: `docs/${input.values.slug}.md`,
          content: `# ${input.values.title}`,
          status: "add",
        });
        state.revision++;
      }
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
it("retries a network failure without claiming a revision conflict or losing text", async () => {
  mount();
  await act(async () => {});
  fireEvent.change(screen.getByLabelText("Исходник документа"), {
    target: { value: "Offline edit" },
  });
  vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await tick();
  expect(screen.getByRole("alert").textContent).toContain("Нет связи");
  expect(screen.queryByText(/Автосохранение остановлено, ваш текст/)).toBeNull();
  expect(readDraft(draftKey("project", "main", "docs/a.mdx"))?.text).toBe("Offline edit");
  await click("Повторить сохранение");
  expect(state.files[0]?.content).toBe("Offline edit");
  expect(requests[0]).toMatchObject({ expectedRevision: 0 });
  expect(readDraft(draftKey("project", "main", "docs/a.mdx"))).toBeUndefined();
});
it("keeps a local backup when permission to save is revoked", async () => {
  mount();
  await act(async () => {});
  fireEvent.change(screen.getByLabelText("Исходник документа"), { target: { value: "Keep this" } });
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: "Нет прав" }, { status: 403 }));
  await tick();
  expect(screen.getByText(/Нет прав на сохранение/)).toBeTruthy();
  expect(screen.getByLabelText("Исходник документа")).toHaveProperty("readOnly", true);
  expect(screen.queryByRole("button", { name: "Повторить сохранение" })).toBeNull();
  expect(readDraft(draftKey("project", "main", "docs/a.mdx"))?.text).toBe("Keep this");
});
it("offers unsaved text after remount and only sends it after explicit restoration", async () => {
  mount();
  fireEvent.change(screen.getByLabelText("Исходник документа"), {
    target: { value: "Recovered edit" },
  });
  cleanup();
  mount();
  expect(screen.getByLabelText("Исходник документа")).toHaveProperty("readOnly", true);
  await tick();
  expect(requests).toHaveLength(0);
  await click("Восстановить текст");
  expect(screen.getByLabelText("Исходник документа")).toHaveProperty("value", "Recovered edit");
  await tick();
  expect(state.files[0]?.content).toBe("Recovered edit");
});
it("requires merging a recovered draft if its server base changed, including after another reload", async () => {
  const key = draftKey("project", "main", "docs/a.mdx");
  writeDraft(key, "My old edit", "Earlier base");
  mount();
  await click("Восстановить текст");
  expect(screen.getByText("Текущая версия PushDocs")).toBeTruthy();
  await tick();
  expect(requests).toHaveLength(0);
  expect(readDraft(key)?.base).toBe("Earlier base");
  cleanup();
  mount();
  await click("Восстановить текст");
  await tick();
  expect(requests).toHaveLength(0);
  await click("Я объединил версии — сохранить");
  expect(state.files[0]?.content).toBe("My old edit");
});
it("opens a text search match using the shortcut and saves the previous file first", async () => {
  mount();
  fireEvent.change(screen.getByLabelText("Исходник документа"), {
    target: { value: "Save before opening" },
  });
  fireEvent.keyDown(window, { key: "F", ctrlKey: true, shiftKey: true });
  expect(document.activeElement).toBe(screen.getByLabelText("Поиск файлов"));
  fireEvent.change(screen.getByLabelText("Поиск файлов"), { target: { value: "Второй" } });
  await act(async () => {
    fireEvent.keyDown(screen.getByLabelText("Поиск файлов"), { key: "Enter" });
  });
  expect(state.files[0]?.content).toBe("Save before opening");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByLabelText("Исходник документа")).toHaveProperty("value", "# Второй");
});
it("shows split preview for articles and only source/diff controls for configuration", async () => {
  mount();
  await click("Файл и просмотр рядом");
  expect(screen.getByLabelText("Исходник документа")).toBeTruthy();
  expect(screen.getByRole("article").textContent).toContain("Первый");
  await click("sidebars.js");
  expect(screen.queryByRole("tab", { name: "Свойства" })).toBeNull();
  expect(screen.queryByRole("tab", { name: "Просмотр" })).toBeNull();
  expect(screen.queryByRole("toolbar", { name: "Форматирование документа" })).toBeNull();
  expect(screen.getByRole("tab", { name: "Файл" })).toBeTruthy();
});
it("persists explorer width and can close other tabs then reopen the last one", async () => {
  mount();
  fireEvent.keyDown(screen.getByRole("separator", { name: "Ширина проводника" }), {
    key: "ArrowRight",
  });
  expect(localStorage.getItem("pushdocs:explorer-width")).toBe("300");
  await click("b.md");
  fireEvent.click(screen.getByLabelText("Действия с вкладками"));
  await click("Закрыть остальные вкладки");
  expect(screen.queryByRole("tab", { name: "a.mdx" })).toBeNull();
  await click("Вернуть закрытую вкладку");
  expect(screen.getByRole("tab", { name: "a.mdx" }).getAttribute("aria-selected")).toBe("true");
  cleanup();
  mount();
  expect(
    screen.getByRole("separator", { name: "Ширина проводника" }).getAttribute("aria-valuenow"),
  ).toBe("300");
});
it("renames a file in its own directory and stages the move atomically", async () => {
  mount();
  fireEvent.contextMenu(screen.getByRole("treeitem", { name: "a.mdx" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("menuitem", { name: "Переименовать" }));
  });
  expect(screen.getByLabelText("Имя файла")).toHaveProperty("value", "a.mdx");
  fireEvent.change(screen.getByLabelText("Имя файла"), { target: { value: "renamed.mdx" } });
  await click("Применить");
  expect(requests[0]).toMatchObject({
    files: [
      { path: "docs/a.mdx", content: null },
      { path: "docs/renamed.mdx", content: "# Первый\n<Widget />", createOnly: true },
    ],
  });
  expect(screen.getByRole("tab", { name: "renamed.mdx" })).toBeTruthy();
});
it("restores open documents independently for each project branch", async () => {
  mount();
  await click("b.md");
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
it("persists reordered tabs without saving or changing the active document", async () => {
  mount();
  await click("b.md");
  fireEvent.change(screen.getByLabelText("Исходник документа"), {
    target: { value: "Unsaved second file" },
  });
  const a = screen.getByRole("tab", { name: "a.mdx" });
  const b = screen.getByRole("tab", { name: "b.md" });
  const dataTransfer = { effectAllowed: "", setData: vi.fn(), setDragImage: vi.fn() };
  fireEvent.dragStart(b, { dataTransfer });
  fireEvent.drop(a, { dataTransfer });
  expect(
    screen.getByRole("tablist", { name: "Открытые документы" }).querySelectorAll('[role="tab"]')[0]
      ?.textContent,
  ).toContain("b.md");
  expect(b.getAttribute("aria-selected")).toBe("true");
  expect(screen.getByLabelText("Исходник документа")).toHaveProperty(
    "value",
    "Unsaved second file",
  );
  expect(requests).toHaveLength(0);
  cleanup();
  mount();
  expect(
    screen.getByRole("tablist", { name: "Открытые документы" }).querySelectorAll('[role="tab"]')[0]
      ?.textContent,
  ).toContain("b.md");
  expect(screen.getByRole("tab", { name: "b.md" }).getAttribute("aria-selected")).toBe("true");
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
it("closes tabs after saving", async () => {
  mount();
  await click("b.md");
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
  fireEvent.click(screen.getByRole("tab", { name: "Свойства" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Название страницы" }), {
    target: { value: "New" },
  });
  await tick();
  expect(requests[0]).toMatchObject({
    files: [{ path: "docs/a.mdx", content: '---\r\ntitle: "New" # keep\r\n---\r\n<Widget />' }],
  });
});
it("closes a background tab without switching the document and keeps an unsaved tab on failure", async () => {
  mount();
  await click("b.md");
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
    fireEvent.click(
      screen.queryByRole("button", { name }) ?? screen.getByRole("treeitem", { name }),
    );
  });
}
async function tick(ms = 1200) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

it("keeps MDX bytes on open and exposes technical files without filters", async () => {
  mount();
  await tick();
  expect(requests).toHaveLength(0);
  expect((screen.getByLabelText("Исходник документа") as HTMLTextAreaElement).value).toBe(
    state.files[0]?.content,
  );
  expect(screen.getByRole("treeitem", { name: "sidebars.js" })).toBeTruthy();
  expect(screen.queryByText("Фильтры документов")).toBeNull();
  expect(screen.queryByLabelText("Служебные файлы")).toBeNull();
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
  expect(screen.getByText("Черновик сохранён")).toBeTruthy();
});
it("saves before switching files and switches comment context", async () => {
  mount();
  fireEvent.change(screen.getByLabelText("Исходник документа"), { target: { value: "правка" } });
  await click("b.md");
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
  await click("b.md");
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
  await click("Новый файл");
  fireEvent.change(screen.getByLabelText("Путь файла"), { target: { value: "docs/new.md" } });
  await click("Создать файл");
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
    fireEvent.click(screen.getByRole("link", { name: /^К изменениям/ }));
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
it("previews replacements without editing or saving until confirmation", async () => {
  mount();
  fireEvent.change(screen.getByLabelText("Найти текст"), { target: { value: "Первый" } });
  fireEvent.change(screen.getByLabelText("Заменить на"), { target: { value: "Новый" } });
  await click("Просмотреть замены");
  expect(screen.getByRole("dialog", { name: "Предпросмотр замены" })).toBeTruthy();
  expect(screen.getByText("После замены")).toBeTruthy();
  await tick();
  expect(requests).toHaveLength(0);
  expect(screen.getByLabelText("Исходник документа")).toHaveProperty(
    "value",
    "# Первый\n<Widget />",
  );
  await click("Отмена");
  expect(requests).toHaveLength(0);
  await click("Просмотреть замены");
  await click("Заменить все (1)");
  await tick();
  expect(requests[0]).toMatchObject({
    files: [{ path: "docs/a.mdx", content: "# Новый\n<Widget />" }],
  });
  fireEvent.click(screen.getByRole("tab", { name: "Просмотр" }));
  expect(screen.getByRole("heading", { name: "Новый" })).toBeTruthy();
});
it("previews MDX imports, admonitions, component children and repository images", () => {
  const file = state.files[0];
  if (!file) throw new Error("Missing fixture");
  file.content =
    "import SupportLink from '@site/src/components/SupportLink';\n\n# Архив\n\n:::tip Важно\nПодключить: <SupportLink>Напишите в поддержку</SupportLink>.\n:::\n\n![Архив](pathname:///img/archive.png)";
  state.repositoryPaths = ["docs/a.mdx", "static/img/archive.png"];
  mount();
  fireEvent.click(screen.getByRole("tab", { name: "Просмотр" }));
  const preview = screen.getByRole("article");
  expect(preview.textContent).not.toContain("import SupportLink");
  expect(preview.textContent).not.toContain(":::tip");
  expect(preview.textContent).not.toContain("<SupportLink>");
  expect(screen.getByRole("note").textContent).toContain("Важно");
  expect(screen.getByRole("img", { name: "Архив" }).getAttribute("src")).toContain(
    "path=static%2Fimg%2Farchive.png",
  );
});
it("marks a deletion without losing its original source", async () => {
  mount();
  await click("Удалить документ");
  await click("Применить");
  expect(requests[0]).toMatchObject({ files: [{ path: "docs/a.mdx", content: null }] });
  expect(screen.getByText(/Документ будет удалён/)).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "Изменения" }));
  expect(screen.getByLabelText("Добавлено строк: 0")).toBeTruthy();
  expect(
    screen.getByLabelText("Сравнение изменений").querySelector('[data-kind="delete"]'),
  ).toBeTruthy();
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
  await click("Новый файл");
  const close = screen.getByRole("button", { name: "Закрыть" });
  expect(document.activeElement).toBe(screen.getByLabelText("Путь файла"));
  close.focus();
  fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(screen.getByText("Создать файл"));
  fireEvent.keyDown(document, { key: "Tab" });
  expect(document.activeElement).toBe(close);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("shows an empty repository", () => {
  state.files = [];
  mount();
  expect(screen.getByText("Нет файлов")).toBeTruthy();
  expect(screen.getByText("Выберите или создайте документ")).toBeTruthy();
});
it("previews template files before applying them atomically", async () => {
  state.config.templates = [
    { id: "doc", label: "Документ", path: "docs/{slug}.md", content: "# {title}", companions: [] },
  ];
  mount();
  await click("Создать по шаблону");
  fireEvent.change(screen.getByRole("textbox", { name: "Заголовок" }), {
    target: { value: "Doc" },
  });
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
  await click("Вставить файл");
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
  expect(
    vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/workbench?")),
  ).toHaveLength(1);
  const original = vi.mocked(fetch).getMockImplementation();
  let failNext = true;
  vi.mocked(fetch).mockImplementation(async (url, options) => {
    if (failNext && String(url).includes("/workbench?")) {
      failNext = false;
      throw new Error("offline");
    }
    if (!original) throw new Error("Missing fixture");
    return original(url, options);
  });
  await tick(15000);
  expect(screen.getByText(/Нет связи с сервером/)).toBeTruthy();
  await click("Закрыть");
  await act(async () => {
    fireEvent.click(screen.getAllByRole("button", { name: "Получить из Git" })[0]!);
  });
  expect(mocks.start).toHaveBeenCalledWith({ projectId: "project", branch: "main" });
  expect(screen.getByText("Изменения получены из Git")).toBeTruthy();
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
    fireEvent.click(screen.getByRole("link", { name: /^К изменениям/ }));
  });
  fireEvent.change(screen.getByLabelText("Исходник документа"), { target: { value: "вторая" } });
  await act(async () => {
    release(Response.json({ saved: true }));
  });
  expect(mocks.push).not.toHaveBeenCalled();
  await tick();
  expect(state.files[0]?.content).toBe("вторая");
});

it("protects unload and saves before sidebar navigation", async () => {
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
});

it("opens document tabs and manually saves a selected component", async () => {
  mount();
  await click("b.md");
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
  expect(screen.getByRole("alert").textContent).toContain("Нет связи с сервером");
  mocks.start.mockRejectedValueOnce(new Error("sync failed"));
  await act(async () => {
    fireEvent.click(screen.getAllByRole("button", { name: "Получить из Git" })[0]!);
  });
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

it("hides internal project configuration from the file tree", () => {
  state.role = "admin";
  const content = JSON.stringify(state.config, null, 2);
  state.files.push({
    path: ".pushdocs/config.json",
    content,
    baseContent: content,
    title: "config.json",
    locale: "ru",
    version: "current",
    status: "clean",
  });
  mount();
  expect(screen.queryByText("Настройки файлов")).toBeNull();
  expect(screen.queryByRole("treeitem", { name: ".pushdocs" })).toBeNull();
  expect(screen.queryByRole("treeitem", { name: "config.json" })).toBeNull();
  expect(requests).toHaveLength(0);
});

it("opens repository source outside the import profile as read-only", async () => {
  state.repositoryPaths = ["src/app.ts", "logo.png"];
  mount();
  await click("src");
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ content: "export const app = 1;" }));
  await click("app.ts");
  expect(screen.getByLabelText("Исходник документа")).toHaveProperty(
    "value",
    "export const app = 1;",
  );
  expect(screen.getByLabelText("Исходник документа")).toHaveProperty("readOnly", true);
  expect(requests).toHaveLength(0);
  expect(screen.getByRole("button", { name: "Новый файл" })).toHaveProperty("disabled", false);
});
it("creates a folder inside the selected directory", async () => {
  mount();
  await click("Новая папка");
  expect(screen.getByLabelText("Путь папки")).toHaveProperty("value", "docs/new-folder");
  await click("Создать папку");
  expect(requests[0]).toMatchObject({
    action: "folder",
    path: "docs/new-folder",
    expectedRevision: 0,
  });
});
it("opens comments on demand and hides insertion tools outside source mode", async () => {
  mount();
  const panel = screen.getByText("Обсуждение docs/a.mdx").closest("aside");
  expect(panel?.hidden).toBe(true);
  await click("Комментарии");
  expect(panel?.hidden).toBe(false);
  await click("b.md");
  expect(screen.getByRole("complementary", { name: "Обсуждение документа" }).textContent).toContain(
    "Обсуждение docs/b.md",
  );
  await click("Закрыть комментарии");
  expect(panel?.hidden).toBe(true);
  fireEvent.click(screen.getByRole("tab", { name: "Просмотр" }));
  expect(screen.queryByRole("toolbar", { name: "Форматирование документа" })).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "Файл" }));
  expect(screen.getByRole("toolbar", { name: "Форматирование документа" })).toBeTruthy();
});

it("dismisses secondary actions with Escape or an outside click", () => {
  mount();
  const trigger = screen.getByLabelText("Действия с документом");
  const menu = trigger.closest("details");
  fireEvent.click(trigger);
  expect(menu?.open).toBe(true);
  fireEvent.keyDown(document, { key: "Tab" });
  expect(menu?.open).toBe(true);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(menu?.open).toBe(false);
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  fireEvent.pointerDown(trigger);
  expect(menu?.open).toBe(true);
  fireEvent.pointerDown(screen.getByLabelText("Исходник документа"));
  expect(menu?.open).toBe(false);
});

it("shows committed changes and immediate unsaved edits in the tree and tabs", async () => {
  const original = vi.mocked(fetch).getMockImplementation();
  vi.mocked(fetch).mockImplementation(async (url, options) => {
    if (String(url).includes("/file-statuses?"))
      return Response.json({ sha: state.sha, statuses: { "docs/a.mdx": "add" } });
    if (!original) throw new Error("Missing fixture");
    return original(url, options);
  });
  mount();
  await tick(0);
  expect(screen.getByRole("treeitem", { name: "a.mdx" }).dataset.status).toBe("add");
  expect(screen.getByRole("tab", { name: "a.mdx" }).parentElement?.dataset.status).toBe("add");
  await click("b.md");
  fireEvent.change(screen.getByLabelText("Исходник документа"), { target: { value: "Typing" } });
  expect(screen.getByRole("treeitem", { name: "b.md" }).dataset.status).toBe("modify");
  expect(requests).toHaveLength(0);
});

it("saves the article before uploading and immediately reveals the attachment as a new file", async () => {
  const original = vi.mocked(fetch).getMockImplementation();
  if (!original) throw new Error("Missing fixture");
  vi.mocked(fetch).mockImplementation(async (url, options) => {
    if (String(url).includes("/media?"))
      return Response.json({
        assets: (state.uploads ?? []).map(({ path }) => ({
          path,
          url: "/img/new.png",
          status: "upload",
          size: 5,
          usages: [],
        })),
        revision: state.revision,
        role: "editor",
        status: "open",
        locale: "ru",
      });
    return original(url, options);
  });
  class UploadRequest extends EventTarget {
    upload = new EventTarget();
    status = 200;
    responseText = JSON.stringify({ path: "static/img/new.png" });
    open(_method: string, url: string) {
      const query = new URL(url, "https://cms.test").searchParams;
      expect(query.get("branch")).toBe("main");
      expect(query.get("document")).toBe("docs/a.mdx");
      expect(query.get("revision")).toBe("1");
    }
    send() {
      state.uploads = [{ path: "static/img/new.png" }];
      state.revision++;
      queueMicrotask(() => this.dispatchEvent(new Event("load")));
    }
    abort() {}
  }
  vi.stubGlobal("XMLHttpRequest", UploadRequest);
  mount();
  fireEvent.change(screen.getByLabelText("Исходник документа"), {
    target: { value: "# Unsaved article" },
  });
  await click("Вставить файл");
  expect(requests[0]).toMatchObject({
    files: [{ path: "docs/a.mdx", content: "# Unsaved article" }],
  });
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Загрузить файлы"), {
      target: { files: [new File(["image"], "new.png")] },
    });
  });
  await click("Закрыть");
  expect(screen.getByRole("treeitem", { name: "new.png" }).textContent).toContain("A");
  expect(screen.getByLabelText("Исходник документа")).toHaveProperty("value", "# Unsaved article");
  const calls = vi.mocked(fetch).mock.calls.length;
  await click("new.png");
  expect(
    vi
      .mocked(fetch)
      .mock.calls.slice(calls)
      .some(([url]) => String(url).includes("workbench?") && String(url).includes("path=")),
  ).toBe(false);
  expect(screen.getByRole("img", { name: "new.png" }).getAttribute("src")).toContain(
    "/assets?branch=main&path=static%2Fimg%2Fnew.png",
  );
});
it("opens a replacement upload from the draft instead of downloading the old Git binary", async () => {
  state.repositoryPaths = ["logo.png"];
  state.uploads = [{ path: "logo.png" }];
  render(
    <Workbench
      projectId="project"
      projectName="Docs"
      branch="main"
      initial={state}
      initialPath="logo.png"
    />,
  );
  expect(screen.getByRole("treeitem", { name: "logo.png" }).textContent).toContain("M");
  expect(screen.getByRole("link", { name: "Скачать файл" }).getAttribute("href")).toContain(
    "/assets?",
  );
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(
        ([url]) => String(url).includes("workbench?") && String(url).includes("path="),
      ),
  ).toBe(false);
});

it("saves the open draft before a dropped article and reveals its branch change", async () => {
  mount();
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Исходник документа"), {
      target: { value: "# My draft" },
    });
  });
  const file = new File(["# Uploaded\r\n"], "uploaded.md");
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => new TextEncoder().encode("# Uploaded\r\n").buffer,
  });
  await act(async () => {
    fireEvent.drop(screen.getByRole("treeitem", { name: "docs" }), {
      dataTransfer: { types: ["Files"], files: [file] },
    });
  });
  expect(requests).toHaveLength(2);
  expect(requests[0]).toMatchObject({
    expectedRevision: 0,
    files: [{ path: "docs/a.mdx", content: "# My draft" }],
  });
  expect(requests[1]).toMatchObject({
    branch: "main",
    expectedRevision: 1,
    files: [{ path: "docs/uploaded.md", content: "# Uploaded\r\n", createOnly: true }],
  });
  expect(screen.getByRole("treeitem", { name: "uploaded.md" }).dataset.status).toBe("add");
  expect((screen.getByLabelText("Исходник документа") as HTMLTextAreaElement).value).toBe(
    "# My draft",
  );
});
