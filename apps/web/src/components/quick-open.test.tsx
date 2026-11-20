// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
    expect(within(screen.getByRole("list")).getByRole("button").textContent).toContain(text);
    expect(container.querySelector("img")).toBeNull();
  },
);
it("finds only file basenames, excluding folders, article titles and deleted drafts", () => {
  expect(searchFiles(paths, files, "БЫСТРЫЙ", false)).toEqual([]);
  expect(searchFiles(paths, files, "docs", false)).toEqual([]);
  expect(searchFiles(paths, files, "START", false).map((file) => file.path)).toEqual([
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

it("applies case and whole-word controls to text results and their highlights", () => {
  const article = {
    path: "docs/test.md",
    title: "Тест",
    status: "clean",
    content: "Письмо письмо письмом",
  };
  const { container } = render(
    <QuickOpen paths={[article.path]} files={[article]} onOpen={vi.fn()} initialContent />,
  );
  fireEvent.change(screen.getByLabelText("Поиск файлов"), { target: { value: "письмо" } });
  expect(container.querySelectorAll("mark")).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "Учитывать регистр" }));
  expect(container.querySelectorAll("mark")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Слово целиком" }));
  expect(container.querySelectorAll("mark")).toHaveLength(1);
  fireEvent.change(screen.getByLabelText("Поиск файлов"), { target: { value: "ПИСЬМО" } });
  expect(screen.getByText("Совпадений в статьях не найдено.")).toBeTruthy();
  expect(
    searchFiles([article.path], [article], "Test", false, { matchCase: true, wholeWord: false }),
  ).toEqual([]);
  expect(
    searchFiles([article.path], [article], "tes", false, { matchCase: false, wholeWord: true }),
  ).toEqual([]);
});
it("opens the keyboard-selected search result at its matching line", () => {
  const open = vi.fn();
  render(<QuickOpen paths={paths} files={files} onOpen={open} initialContent />);
  const input = screen.getByLabelText("Поиск файлов");
  fireEvent.change(input, { target: { value: "письмо" } });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(document.activeElement).toBe(within(screen.getByRole("list")).getAllByRole("button")[0]);
  fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowDown" });
  fireEvent.click(document.activeElement as HTMLElement);
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
    expect(remote).toHaveBeenCalledWith("искомая", expect.any(AbortSignal), {
      matchCase: false,
      wholeWord: false,
    });
    expect(within(screen.getByRole("list")).getByRole("button").textContent).toContain(
      "искомая фраза",
    );
    expect(screen.getByText("искомая").tagName).toBe("MARK");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(open).toHaveBeenCalledWith("docs/archive.md", 27);
  } finally {
    vi.useRealTimers();
  }
});

it.each([false, true])(
  "shows a server-search error and retains loaded matches: %s",
  async (loaded) => {
    vi.useFakeTimers();
    try {
      render(
        <QuickOpen
          paths={paths}
          files={files.map((file, index) =>
            loaded && index === 0 ? file : { ...file, content: "", loaded: false },
          )}
          onOpen={vi.fn()}
          onSearchContent={vi.fn().mockRejectedValue(new Error("offline"))}
          initialContent
        />,
      );
      fireEvent.change(screen.getByLabelText("Поиск файлов"), {
        target: { value: "письмо" },
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(180);
      });
      expect(screen.getByRole("alert").textContent).toBe(
        "Не удалось выполнить поиск. Повторите попытку.",
      );
      expect(screen.queryByText("Совпадений в статьях не найдено.")).toBeNull();
      const results = within(screen.getByRole("list", { name: "Результаты поиска" }));
      if (loaded) expect(results.getByRole("button").textContent).toContain("docs/start.mdx:3");
      else expect(results.queryByRole("button")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  },
);

it("uses loaded buffers over server matches without restarting the remote search", async () => {
  vi.useFakeTimers();
  try {
    const remote = vi.fn().mockResolvedValue([
      { path: "docs/start.mdx", line: 90, excerpt: "письмо в старой версии" },
      { path: "docs/archive.md", line: 27, excerpt: "письмо из Git" },
      { path: "docs/deleted.md", line: 1, excerpt: "письмо удалено" },
    ]);
    const data = {
      paths,
      onOpen: vi.fn(),
      onSearchContent: remote,
      initialContent: true,
    };
    const partialFiles = files.map((file) =>
      file.path === "docs/archive.md" ? { ...file, content: "", loaded: false } : file,
    );
    const view = render(<QuickOpen {...data} files={partialFiles} />);
    fireEvent.change(screen.getByLabelText("Поиск файлов"), { target: { value: "письмо" } });
    const list = screen.getByRole("list", { name: "Результаты поиска" });
    expect(within(list).getByRole("button").textContent).toContain("docs/start.mdx:3");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
    });
    expect(within(list).getAllByRole("button")).toHaveLength(2);
    expect(list.textContent).toContain("docs/archive.md:27");
    expect(list.textContent).not.toContain("старой версии");
    expect(list.textContent).not.toContain("deleted.md");

    view.rerender(
      <QuickOpen
        {...data}
        files={partialFiles.map((file) =>
          file.path === "docs/start.mdx"
            ? { ...file, content: "# Правка\n\n\nписьмо в буфере" }
            : file,
        )}
      />,
    );
    expect(within(list).getAllByRole("button")).toHaveLength(2);
    expect(list.textContent).toContain("docs/start.mdx:4");
    expect(list.textContent).toContain("письмо в буфере");

    view.rerender(
      <QuickOpen
        {...data}
        files={partialFiles.map((file) =>
          file.path === "docs/start.mdx" ? { ...file, content: "# Исправлено" } : file,
        )}
      />,
    );
    expect(within(list).getByRole("button").textContent).toContain("docs/archive.md:27");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(remote).toHaveBeenCalledTimes(1);
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
  fireEvent.click(within(screen.getByRole("list")).getAllByRole("button")[1] as HTMLElement);
  expect(open).toHaveBeenCalledWith("docs/file-1.md", undefined);
  fireEvent.click(screen.getByRole("button", { name: "По тексту" }));
  expect(input.getAttribute("placeholder")).toContain("Фраза");
  fireEvent.click(screen.getByRole("button", { name: "По названию" }));
  expect(input.getAttribute("placeholder")).toContain("Имя файла");
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
    expect(within(screen.getByRole("list")).getByRole("button").textContent).toContain("logo.png");
    fireEvent.click(screen.getByRole("button", { name: "По тексту" }));
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

it("does not restart a completed search when the parent recreates its callback", async () => {
  vi.useFakeTimers();
  try {
    const remote = vi.fn().mockResolvedValue([]);
    const data = {
      paths,
      files: files.map((file) => ({ ...file, loaded: false })),
      onOpen: vi.fn(),
      initialContent: true,
    };
    const view = render(
      <QuickOpen {...data} onSearchContent={(query, signal) => remote(query, signal)} />,
    );
    fireEvent.change(screen.getByLabelText("Поиск файлов"), { target: { value: "missing" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
    });
    expect(remote).toHaveBeenCalledTimes(1);
    for (let index = 0; index < 3; index += 1) {
      view.rerender(
        <QuickOpen {...data} onSearchContent={(query, signal) => remote(query, signal)} />,
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
    }
    expect(remote).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it("refreshes server results after a saved revision and ignores an outdated response", async () => {
  vi.useFakeTimers();
  try {
    let finishOld: ((results: Array<{ path: string; excerpt: string }>) => void) | undefined;
    const remote = vi
      .fn()
      .mockResolvedValue([])
      .mockResolvedValueOnce([{ path: "docs/start.mdx", excerpt: "письмо" }])
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve;
          }),
      )
      .mockResolvedValueOnce([{ path: "docs/archive.md", excerpt: "письмо" }]);
    const data = {
      paths,
      files: files.map((file) => ({ ...file, loaded: false })),
      onOpen: vi.fn(),
      onSearchContent: remote,
      initialContent: true,
    };
    const view = render(<QuickOpen {...data} revision={0} />);
    fireEvent.change(screen.getByLabelText("Поиск файлов"), { target: { value: "письмо" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
    });
    expect(screen.getByRole("list").textContent).toContain("start.mdx");
    view.rerender(<QuickOpen {...data} revision={1} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
    });
    view.rerender(<QuickOpen {...data} revision={2} />);
    expect(remote.mock.calls[1]?.[1].aborted).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
    });
    await act(async () => finishOld?.([{ path: "docs/start.mdx", excerpt: "письмо" }]));
    expect(screen.getByRole("list").textContent).toContain("archive.md");
    expect(screen.getByRole("list").textContent).not.toContain("start.mdx");
    view.rerender(<QuickOpen {...data} revision={3} active={false} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(remote).toHaveBeenCalledTimes(3);
    view.rerender(<QuickOpen {...data} revision={3} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
    });
    expect(remote).toHaveBeenCalledTimes(4);
  } finally {
    vi.useRealTimers();
  }
});

it("shows file names without highlights or selected rows, then opens a clicked result immediately", () => {
  const open = vi.fn();
  const { container } = render(<QuickOpen paths={paths} files={files} onOpen={open} />);
  const list = screen.getByRole("list", { name: "Результаты поиска" });
  expect(list.querySelector('[aria-selected="true"], .selected')).toBeNull();
  fireEvent.change(screen.getByLabelText("Поиск файлов"), { target: { value: "start" } });
  expect(within(list).getByRole("button").querySelector("strong")?.textContent).toBe("start.mdx");
  expect(container.querySelector("mark")).toBeNull();
  fireEvent.click(within(list).getByRole("button"));
  expect(open).toHaveBeenCalledWith("docs/start.mdx", undefined);
  fireEvent.click(screen.getByRole("button", { name: "По тексту" }));
  fireEvent.change(screen.getByLabelText("Поиск файлов"), { target: { value: "письмо" } });
  expect(list.querySelector('[aria-selected="true"], .selected')).toBeNull();
  expect(container.querySelector("mark")).not.toBeNull();
  expect(screen.queryByText(/Поиск в импортированных статьях/)).toBeNull();
});
