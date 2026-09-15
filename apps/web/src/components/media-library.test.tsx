// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MediaLibrary } from "./media-library";

vi.mock("next/link", () => ({ default: (props: Record<string, unknown>) => <a {...props} /> }));
const state = {
  assets: [
    {
      path: "static/img/a.png",
      url: "/img/a.png",
      canDelete: true,
      status: "clean",
      size: null,
      usages: ["docs/intro.md"],
    },
  ],
  revision: 3,
  status: "open",
  role: "editor",
  locale: "ru",
};
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(state)),
  );
});
afterEach(cleanup);
it("inserts existing media outside the upload directory without exposing an unsupported deletion", async () => {
  const insert = vi.fn();
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({
      ...state,
      assets: [
        {
          ...state.assets[0],
          path: "staticLocalized/ru/img/forms/filter.gif",
          url: "pathname:///img/forms/filter.gif",
          canDelete: false,
        },
      ],
    }),
  );
  await act(async () => {
    render(
      <MediaLibrary projectId="p" branch="main" document="docs/ecom/a.mdx" onInsert={insert} />,
    );
  });
  fireEvent.click(screen.getByRole("button", { name: "Вставить ссылку" }));
  expect(insert).toHaveBeenCalledWith("pathname:///img/forms/filter.gif");
  expect(screen.queryByRole("button", { name: /Удалить/ })).toBeNull();
  expect(screen.queryByText("Вне каталога вложений")).toBeNull();
});
it("replaces the selected asset at its exact path regardless of the uploaded filename", async () => {
  let requestedUrl = "";
  class Request extends EventTarget {
    upload = new EventTarget();
    timeout = 0;
    status = 200;
    responseText = "{}";
    open(_method: string, url: string) {
      requestedUrl = url;
    }
    send() {
      this.dispatchEvent(new Event("load"));
    }
  }
  vi.stubGlobal("XMLHttpRequest", Request);
  const changed = vi.fn();
  await act(async () => {
    render(
      <MediaLibrary
        projectId="p"
        branch="fix"
        document="docs/intro.md"
        replacePath="static/img/a.png"
        onChanged={changed}
      />,
    );
  });
  expect(screen.getByLabelText("Загрузить файлы")).toHaveProperty("multiple", false);
  expect(screen.queryByText("Настройки загрузки")).toBeNull();
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Загрузить файлы"), {
      target: { files: [new File(["png"], "different.png", { type: "image/png" })] },
    });
  });
  const url = new URL(requestedUrl, "http://localhost");
  expect(url.searchParams.get("path")).toBe("static/img/a.png");
  expect(url.searchParams.get("replace")).toBe("true");
  expect(url.searchParams.get("branch")).toBe("fix");
  expect(url.searchParams.get("revision")).toBe("3");
});
it("rejects multiple replacement files before starting a transfer", async () => {
  await act(async () => {
    render(
      <MediaLibrary
        projectId="p"
        branch="fix"
        document="docs/intro.md"
        replacePath="static/img/a.png"
      />,
    );
  });
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Загрузить файлы"), {
      target: { files: [new File(["a"], "a.png"), new File(["b"], "b.png")] },
    });
  });
  expect(screen.getByRole("alert").textContent).toContain("выберите один файл");
});

it("keeps the upload error when cleanup refresh callbacks also fail", async () => {
  class Request extends EventTarget {
    upload = new EventTarget();
    timeout = 0;
    open() {}
    send() {
      queueMicrotask(() => this.dispatchEvent(new Event("error")));
    }
  }
  vi.stubGlobal("XMLHttpRequest", Request);
  const fetchMock = vi.mocked(fetch);
  fetchMock
    .mockResolvedValueOnce(Response.json(state))
    .mockResolvedValueOnce(Response.json(state))
    .mockRejectedValueOnce(new Error("refresh failed"));
  const changed = vi.fn().mockRejectedValue(new Error("callback failed"));
  await act(async () => {
    render(<MediaLibrary projectId="p" branch="main" document="docs/a.md" onChanged={changed} />);
  });
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Загрузить файлы"), {
      target: { files: [new File(["x"], "a.png")] },
    });
  });
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(changed).toHaveBeenCalledWith();
});
it("shows upload progress and lets the user cancel a transfer", async () => {
  let request: FakeRequest | undefined;
  class FakeRequest extends EventTarget {
    upload = new EventTarget();
    timeout = 0;
    open = vi.fn();
    send = vi.fn();
    abort() {
      this.dispatchEvent(new Event("abort"));
    }
    constructor() {
      super();
      request = this;
    }
  }
  vi.stubGlobal("XMLHttpRequest", FakeRequest);
  await act(async () => {
    render(<MediaLibrary projectId="p" branch="main" document="docs/intro.md" />);
  });
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Загрузить файлы"), {
      target: { files: [new File(["image"], "new.png", { type: "image/png" })] },
    });
  });
  expect(request?.send).toHaveBeenCalled();
  act(() => {
    request?.upload.dispatchEvent(
      new ProgressEvent("progress", { lengthComputable: true, loaded: 2, total: 5 }),
    );
  });
  expect(screen.getByRole("progressbar")).toHaveProperty("value", 40);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Отменить загрузку" }));
  });
  expect(screen.getByRole("alert").textContent).toMatch(/отменена/);
  expect(screen.getByRole("button", { name: "Повторить оставшиеся загрузки" })).toBeTruthy();
});
it("shows media usages and requires an explicit confirmation before staging deletion", async () => {
  await act(async () => {
    render(<MediaLibrary projectId="p" branch="main" document="docs/intro.md" />);
  });
  expect(screen.getByText("static/img/a.png")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Удалить static/img/a.png" }));
  expect(screen.getByRole("link", { name: "docs/intro.md" }).getAttribute("href")).toContain(
    "branch=main&path=docs%2Fintro.md",
  );
  expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить удаление" }));
  });
  expect(fetch).toHaveBeenCalledWith(
    "/api/projects/p/media",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        action: "delete",
        branch: "main",
        path: "static/img/a.png",
        revision: 3,
        document: "docs/intro.md",
        locale: "ru",
      }),
    }),
  );
});

it("uses project upload settings, retains a successful first upload and retries only the failed remainder", async () => {
  const sent: Array<{ url: string; name: string }> = [];
  let fail = true;
  class Request extends EventTarget {
    upload = new EventTarget();
    timeout = 0;
    status = 200;
    responseText = "{}";
    url = "";
    open(_method: string, url: string) {
      this.url = url;
    }
    abort() {
      this.dispatchEvent(new Event("abort"));
    }
    send(file: File) {
      sent.push({ url: this.url, name: file.name });
      this.status = file.name === "b.pdf" && fail ? 409 : 200;
      this.responseText = this.status === 409 ? '{"error":"Revision changed"}' : "{}";
      this.upload.dispatchEvent(
        new ProgressEvent("progress", { lengthComputable: true, loaded: 10, total: 10 }),
      );
      queueMicrotask(() => this.dispatchEvent(new Event("load")));
    }
  }
  vi.stubGlobal("XMLHttpRequest", Request);
  await act(async () => {
    render(<MediaLibrary projectId="p" branch="main" document="docs/intro.md" />);
  });
  expect(screen.queryByText("Настройки загрузки")).toBeNull();
  expect(screen.queryByLabelText("Каталог назначения")).toBeNull();
  expect(screen.queryByLabelText("Заменять существующие файлы с такими же путями")).toBeNull();
  expect(screen.queryByLabelText("Язык каталога")).toBeNull();
  const region = screen.getByRole("region", { name: "Загрузка файлов" });
  fireEvent.dragOver(region);
  await act(async () => {
    fireEvent.drop(region, {
      dataTransfer: { files: [new File(["a"], "a.png"), new File(["b"], "b.pdf")] },
    });
  });
  expect(sent.map((item) => item.name)).toEqual(["a.png", "b.pdf"]);
  expect(new URL(sent[0]?.url ?? "", "http://localhost").searchParams.has("path")).toBe(false);
  expect(sent[0]?.url).toContain("replace=false");
  expect(screen.getByRole("alert").textContent).toContain("Revision changed");
  fail = false;
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Повторить оставшиеся загрузки" }));
  });
  expect(sent.map((item) => item.name)).toEqual(["a.png", "b.pdf", "b.pdf"]);
  expect(screen.queryByRole("alert")).toBeNull();
});

it.each(["error", "timeout", "invalid-json"])(
  "reports an upload %s and preserves the pending file",
  async (eventType) => {
    class Request extends EventTarget {
      upload = new EventTarget();
      timeout = 0;
      responseText = "not json";
      open() {}
      send() {
        queueMicrotask(() =>
          this.dispatchEvent(new Event(eventType === "invalid-json" ? "load" : eventType)),
        );
      }
    }
    vi.stubGlobal("XMLHttpRequest", Request);
    await act(async () => {
      render(<MediaLibrary projectId="p" branch="main" document="docs/a.md" />);
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Загрузить файлы"), {
        target: { files: [new File(["x"], "a.png")] },
      });
    });
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Повторить оставшиеся загрузки" })).toBeTruthy();
  },
);

it("filters files and refreshes after an external event", async () => {
  await act(async () => {
    render(<MediaLibrary projectId="p" branch="main" document="docs/a.md" />);
  });
  fireEvent.change(screen.getByLabelText("Найти файл"), { target: { value: "absent" } });
  expect(screen.queryByText("static/img/a.png")).toBeNull();
  await act(async () => {
    window.dispatchEvent(new Event("pushdocs:refresh"));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Обновить" }));
  });
  expect(fetch).toHaveBeenCalledTimes(3);
});

it("keeps reader uploads disabled, shows out-of-scope media and reports refresh failures", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({
      ...state,
      role: "reader",
      assets: [
        {
          path: "other/a.pdf",
          url: "../other/a.pdf",
          canDelete: false,
          size: 120,
          usages: [],
          status: "clean",
        },
      ],
    }),
  );
  await act(async () => {
    render(<MediaLibrary projectId="p" branch="main" document="docs/a.md" />);
  });
  expect(screen.getByLabelText("Загрузить файлы")).toHaveProperty("disabled", true);
  expect(screen.queryByText("Вне каталога вложений")).toBeNull();
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({ error: "Session expired" }, { status: 401 }),
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Обновить" }));
  });
  expect(screen.getByRole("alert").textContent).toContain("Session expired");
});

it("cancels deletion and can revert an already staged deletion", async () => {
  await act(async () => {
    render(<MediaLibrary projectId="p" branch="main" document="docs/a.md" />);
  });
  fireEvent.click(screen.getByRole("button", { name: "Удалить static/img/a.png" }));
  fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
  expect(screen.queryByRole("region", { name: "Удаление файла" })).toBeNull();
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({ ...state, assets: [{ ...state.assets[0], status: "delete" }] }),
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Обновить" }));
  });
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({ error: "Revision conflict" }, { status: 409 }),
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Отменить удаление static/img/a.png" }));
  });
  expect(screen.getByRole("alert").textContent).toContain("Revision conflict");
});

it("rejects an oversized file without sending it", async () => {
  await act(async () => {
    render(<MediaLibrary projectId="p" branch="main" document="docs/a.md" />);
  });
  const file = new File(["x"], "huge.png");
  Object.defineProperty(file, "size", { value: 65 * 1024 * 1024 });
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Загрузить файлы"), { target: { files: [file] } });
  });
  expect(screen.getByRole("alert").textContent).toContain("64 МиБ");
});

it("can recover from an initial network failure into an empty media library", async () => {
  vi.mocked(fetch).mockRejectedValueOnce(new Error("Offline"));
  await act(async () => {
    render(<MediaLibrary projectId="p" branch="main" document="docs/a.md" />);
  });
  expect(screen.getByRole("alert").textContent).toContain("Offline");
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...state, assets: [] }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Обновить" }));
  });
  expect(screen.getByText("В этой ветке пока нет медиафайлов.")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("filters attachments by the article without redundant branch and changes captions", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({
      ...state,
      assets: [
        ...state.assets,
        { ...state.assets[0], path: "static/img/other.png", usages: ["docs/other.md"] },
      ],
    }),
  );
  await act(async () => {
    render(<MediaLibrary projectId="p" branch="docs/fix" document="docs/intro.md" />);
  });
  fireEvent.click(screen.getByLabelText("Только в этой статье"));
  expect(screen.getByText("static/img/a.png")).toBeTruthy();
  expect(screen.queryByText("static/img/other.png")).toBeNull();
  expect(screen.queryByRole("link", { name: "«Изменения»" })).toBeNull();
  expect(screen.queryByText("docs/fix")).toBeNull();
  expect(screen.queryByText("Выбрать файлы")).toBeNull();
});
