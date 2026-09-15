// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { QuickOpen, searchFiles } from "./quick-open";

afterEach(cleanup);
const files = [
  {
    path: "docs/start.mdx",
    title: "Быстрый старт",
    content: "# Старт\n\nОтправить письмо",
    status: "modify",
  },
  {
    path: "docs/archive.md",
    title: "Архив",
    content: "# Архив\nОтправить письмо",
    status: "clean",
  },
  { path: "docs/deleted.md", title: "Удалено", content: "Отправить письмо", status: "delete" },
  { path: "config.json", title: "Конфигурация", content: "Отправить письмо", status: "clean" },
];
const paths = [...files.map((file) => file.path), "static/logo.png"];

it.each([
  { query: "ПИСЬМО", text: "Отправить письмо и Письмо повторно", matches: ["письмо", "Письмо"] },
  {
    query: "a+b (test)",
    text: "<img> a+b (test) и A+B (TEST)",
    matches: ["a+b (test)", "A+B (TEST)"],
  },
])(
  "highlights every literal match in excerpts while preserving original text: $query",
  ({ query, text, matches }) => {
    const file = { path: "docs/example.md", title: "Article", content: text, status: "clean" };
    const { container } = render(
      <QuickOpen paths={[file.path]} files={[file]} onOpen={vi.fn()} initialContent />,
    );
    fireEvent.change(screen.getByLabelText("Поиск файлов"), { target: { value: query } });
    expect(Array.from(container.querySelectorAll("mark"), (mark) => mark.textContent)).toEqual(
      matches,
    );
    expect(screen.getByRole("option").textContent).toContain(text);
    expect(container.querySelector("img")).toBeNull();
  },
);
it("finds filenames and article titles, including unloaded files, without deleted drafts", () => {
  expect(searchFiles(paths, files, "БЫСТРЫЙ", false).map((file) => file.path)).toEqual([
    "docs/start.mdx",
  ]);
  expect(searchFiles(paths, files, "logo", false).map((file) => file.path)).toEqual([
    "static/logo.png",
  ]);
  expect(searchFiles(paths, files, "deleted", false)).toEqual([]);
});
it("searches article text with original line numbers and excludes configuration files", () => {
  const results = searchFiles(paths, files, "отправить", true);
  expect(results.map(({ path, line }) => ({ path, line }))).toEqual([
    { path: "docs/start.mdx", line: 3 },
    { path: "docs/archive.md", line: 2 },
  ]);
  expect(results[0]?.excerpt).toContain("Отправить письмо");
  expect(searchFiles(paths, files, " ", true)).toEqual([]);
});
it("opens the keyboard-selected search result at its matching line", () => {
  const open = vi.fn();
  render(<QuickOpen paths={paths} files={files} onOpen={open} initialContent />);
  const input = screen.getByLabelText("Поиск файлов");
  fireEvent.change(input, { target: { value: "письмо" } });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(open).toHaveBeenCalledWith("docs/archive.md", 2);
  fireEvent.change(input, { target: { value: "несуществующий" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(open).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Совпадений в статьях не найдено.")).toBeTruthy();
});

it("searches unloaded article bodies on the server and opens the returned line", async () => {
  vi.useFakeTimers();
  try {
    const open = vi.fn();
    const remote = vi.fn().mockResolvedValue([
      {
        path: "docs/archive.md",
        title: "Архив",
        line: 27,
        excerpt: "искомая фраза",
      },
    ]);
    render(
      <QuickOpen
        paths={paths}
        files={files.map((file) => ({ ...file, content: "", loaded: false }))}
        onOpen={open}
        onSearchContent={remote}
        initialContent
      />,
    );
    const input = screen.getByLabelText("Поиск файлов");
    fireEvent.change(input, { target: { value: "искомая" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
    });
    expect(remote).toHaveBeenCalledWith("искомая", expect.any(AbortSignal));
    expect(screen.getByRole("option").textContent).toContain("искомая фраза");
    expect(screen.getByText("искомая").tagName).toBe("MARK");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(open).toHaveBeenCalledWith("docs/archive.md", 27);
  } finally {
    vi.useRealTimers();
  }
});

it("shows a server-search error instead of an empty result state", async () => {
  vi.useFakeTimers();
  try {
    render(
      <QuickOpen
        paths={paths}
        files={files.map((file) => ({ ...file, content: "", loaded: false }))}
        onOpen={vi.fn()}
        onSearchContent={vi.fn().mockRejectedValue(new Error("offline"))}
        initialContent
      />,
    );
    fireEvent.change(screen.getByLabelText("Поиск файлов"), {
      target: { value: "искомая" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
    });
    expect(screen.getByRole("alert").textContent).toBe(
      "Не удалось выполнить поиск. Повторите попытку.",
    );
    expect(screen.queryByText("Совпадений в статьях не найдено.")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it("switches search modes, opens clicked results and caps broad matches", () => {
  const open = vi.fn();
  const many = Array.from({ length: 105 }, (_, index) => ({
    path: `docs/file-${index}.md`,
    title: `File ${index}`,
    content: "common",
    status: "clean",
  }));
  render(<QuickOpen paths={many.map((file) => file.path)} files={many} onOpen={open} />);
  const input = screen.getByLabelText("Поиск файлов");
  fireEvent.change(input, { target: { value: "file" } });
  expect(screen.getByText("Первые 100 результатов. Уточните запрос.")).toBeTruthy();
  fireEvent.click(screen.getAllByRole("option")[1] as HTMLElement);
  expect(open).toHaveBeenCalledWith("docs/file-1.md", undefined);
  fireEvent.click(screen.getByRole("button", { name: "Текст статей" }));
  expect(input.getAttribute("placeholder")).toContain("Фраза");
  fireEvent.click(screen.getByRole("button", { name: "Имя или название" }));
  expect(input.getAttribute("placeholder")).toContain("Название");
  fireEvent.keyDown(input, { key: "ArrowUp" });
});

it("falls back to a path basename and exposes pending remote search", async () => {
  vi.useFakeTimers();
  try {
    let finish: ((results: never[]) => void) | undefined;
    const remote = vi.fn(
      () =>
        new Promise<never[]>((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(
      <QuickOpen
        paths={["docs/unloaded.md", "static/logo.png"]}
        files={[
          {
            path: "docs/unloaded.md",
            title: "",
            content: "",
            status: "clean",
            loaded: false,
          },
        ]}
        onOpen={vi.fn()}
        onSearchContent={remote}
      />,
    );
    const input = screen.getByLabelText("Поиск файлов");
    fireEvent.change(input, { target: { value: "logo" } });
    expect(screen.getByRole("option").textContent).toContain("logo.png");
    fireEvent.click(screen.getByRole("button", { name: "Текст статей" }));
    fireEvent.change(input, { target: { value: "remote" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
    });
    expect(screen.getByRole("status").textContent).toContain("Ищем");
    view.unmount();
    await act(async () => finish?.([]));
  } finally {
    vi.useRealTimers();
  }
});
