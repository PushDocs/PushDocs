// @vitest-environment jsdom
import { parseProjectConfig } from "@pushdocs/content/config";
import { mediaCatalog } from "@pushdocs/content/media";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MediaLibrary } from "./media-library";

vi.mock("next/link", () => ({ default: (props: Record<string, unknown>) => <a {...props} /> }));
const state = {
  assets: [
    {
      path: "static/img/a.png",
      url: "/img/a.png",
      canDelete: true,
      inRepository: true,
      status: "clean",
      size: null,
      usages: ["docs/intro.md"],
    },
  ],
  uploadDirectory: "static/img/uploads",
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
function prepareUpload(directory = "static/img/uploads") {
  const field = screen.queryByLabelText("Папка загрузки") as HTMLInputElement | null;
  if (field) fireEvent.change(field, { target: { value: directory } });
}

it("keeps a shadowed file downloadable without offering insertion of another resource", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({
      ...state,
      assets: [{ ...state.assets[0], url: null, shadowedBy: "localized/en/a.png" }],
    }),
  );
  await act(async () => {
    render(<MediaLibrary projectId="p" branch="main" document="docs/a.md" onInsert={vi.fn()} />);
  });
  expect(screen.queryByRole("button", { name: "Вставить static/img/a.png" })).toBeNull();
  expect(screen.getByText(/этот URL используется файлом localized\/en\/a.png/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Скачать static/img/a.png" })).toBeTruthy();
});

it("shows video frames for MP4 assets and keeps deleted videos as placeholders", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({
      ...state,
      assets: [
        { ...state.assets[0], path: "static/video/demo.MP4", url: "/video/demo.MP4" },
        { ...state.assets[0], path: "static/video/deleted.mp4", status: "delete" },
      ],
    }),
  );
  await act(async () => {
    render(<MediaLibrary projectId="p" branch="main" document="docs/a.md" />);
  });
  const preview = screen.getByRole("figure", { name: "Превью видео demo.MP4" });
  await waitFor(() =>
    expect(preview.querySelector("video")?.getAttribute("src")).toBe(
      "/api/projects/p/assets?branch=main&path=static%2Fvideo%2Fdemo.MP4&revision=3",
    ),
  );
  expect(screen.queryByRole("figure", { name: "Превью видео deleted.mp4" })).toBeNull();
  expect(screen.getByText("Удаление")).toBeTruthy();
});

it("inserts and allows deleting existing media outside the upload directory", async () => {
  const insert = vi.fn();
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({
      ...state,
      assets: [
        {
          ...state.assets[0],
          path: "staticLocalized/ru/img/forms/filter.gif",
          url: "pathname:///img/forms/filter.gif",
          canDelete: true,
        },
      ],
    }),
  );
  await act(async () => {
    render(
      <MediaLibrary projectId="p" branch="main" document="docs/ecom/a.mdx" onInsert={insert} />,
    );
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Вставить staticLocalized/ru/img/forms/filter.gif" }),
  );
  expect(insert).toHaveBeenCalledWith(
    "pathname:///img/forms/filter.gif",
    "staticLocalized/ru/img/forms/filter.gif",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Удалить staticLocalized/ru/img/forms/filter.gif" }),
  );
  expect(
    screen.getByRole("heading", { name: "Удалить staticLocalized/ru/img/forms/filter.gif?" }),
  ).toBeTruthy();
  expect(screen.queryByText("Вне каталога вложений")).toBeNull();
});

it("shows only added draft files in the first group, without duplicates, and filters them by search", async () => {
  vi.mocked(fetch).mockResolvedValue(
    Response.json({
      ...state,
      assets: [
        state.assets[0],
        { ...state.assets[0], path: "static/img/new.png", inRepository: false, status: "upload" },
        { ...state.assets[0], path: "other/new.pdf", inRepository: false, status: "upload" },
        { ...state.assets[0], path: "static/img/replacement.png", status: "upload" },
        { ...state.assets[0], path: "static/img/deleted.png", status: "delete" },
      ],
    }),
  );
  const insert = vi.fn();
  await act(async () => {
    render(<MediaLibrary projectId="p" branch="main" document="docs/a.md" onInsert={insert} />);
  });
  expect(document.querySelector(".media-group h3")?.textContent).toBe("Новые файлы");
  const added = screen.getByRole("region", { name: "Новые файлы" });
  expect(
    within(added)
      .getAllByRole("article")
      .map((card) => card.querySelector("strong")?.title),
  ).toEqual(["static/img/new.png", "other/new.pdf"]);
  expect(screen.getAllByRole("article")).toHaveLength(5);
  fireEvent.click(screen.getByRole("button", { name: "Вставить static/img/new.png" }));
  expect(insert).toHaveBeenCalledWith("/img/a.png", "static/img/new.png");

  fireEvent.change(screen.getByLabelText("Найти файл"), { target: { value: "replacement" } });
  expect(screen.queryByRole("region", { name: "Новые файлы" })).toBeNull();
  expect(screen.getAllByRole("article")).toHaveLength(1);
  fireEvent.change(screen.getByLabelText("Найти файл"), { target: { value: "new.pdf" } });
  expect(screen.getByRole("region", { name: "Новые файлы" })).toBeTruthy();
  expect(screen.getAllByRole("article")).toHaveLength(1);
});

it("shows grouped media in insertion mode with filenames, subtle paths and explicit actions", async () => {
  const paths = [
    "static/img/logo.svg",
    "assets/en/pictures/forms/english.png",
    "assets/ru/pictures/shared/shared.png",
    "assets/ru/pictures/forms/article.png",
  ];
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({
      ...state,
      directories: ["assets/ru/pictures", "assets/en/pictures", "static/img"],
      uploadDirectory: "assets/ru/pictures/forms",
      assets: paths.map((path) => ({ ...state.assets[0], path, url: "/img/file.png" })),
    }),
  );
  const insert = vi.fn();
  await act(async () => {
    render(
      <MediaLibrary
        projectId="p"
        branch="main"
        document="docs/forms/a.mdx"
        insertionMode="docmedia"
        onInsert={insert}
      />,
    );
  });
  expect(screen.getByLabelText("Найти файл")).toHaveProperty("value", "assets/ru/pictures/forms");
  fireEvent.change(screen.getByLabelText("Найти файл"), { target: { value: "" } });
  expect(
    [...document.querySelectorAll(".media-group h3")].map((heading) => heading.textContent),
  ).toEqual(["Файлы · assets/ru/pictures", "Файлы · assets/en/pictures", "Файлы · static/img"]);
  const group = screen.getByRole("region", { name: "Файлы · assets/ru/pictures" });
  expect(within(group).getByText("article.png").tagName).toBe("STRONG");
  expect(within(group).getByText("forms/article.png").className).toBe("media-card-path");
  expect(screen.queryByText(/assets\/.*\.png/)).toBeNull();
  expect(screen.queryByRole("button", { name: /^Заменить / })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Файлы из папки статьи" })).toBeNull();
  expect(screen.getByLabelText("Папка загрузки")).toHaveProperty(
    "value",
    "assets/ru/pictures/forms",
  );
  const remove = within(group).getByRole("button", { name: `Удалить ${paths[3]}` });
  expect(remove.textContent).toBe("");
  const download = within(group).getByRole("link", { name: `Скачать ${paths[3]}` });
  expect(download.getAttribute("download")).toBe("article.png");
  expect(download.getAttribute("href")).toContain("download=true");
  const button = within(group).getByRole("button", { name: `Вставить ${paths[3]}` });
  expect(button.textContent).toContain("Вставить");
  fireEvent.click(button);
  expect(insert).toHaveBeenCalledWith("/img/file.png", paths[3]);
  prepareUpload("another/ru/directory");
  fireEvent.change(screen.getByLabelText("Найти файл"), { target: { value: "" } });
  expect(screen.getByRole("region", { name: "Файлы · assets/ru/pictures" })).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Файлы · another/ru/directory" })).toBeNull();
});

it("initializes generic insertion from the project directory and allows selecting existing attachments", async () => {
  const insert = vi.fn();
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({
      ...state,
      assets: [{ ...state.assets[0], path: "static/files/guide.pdf", url: "/files/guide.pdf" }],
    }),
  );
  await act(async () => {
    render(
      <MediaLibrary
        projectId="p"
        branch="main"
        document="docs/a.md"
        insertionMode="markdown"
        onInsert={insert}
      />,
    );
  });
  expect(screen.getByLabelText("Папка загрузки")).toHaveProperty("value", state.uploadDirectory);
  expect(screen.getByLabelText("Найти файл")).toHaveProperty("value", state.uploadDirectory);
  expect(screen.getByLabelText("Загрузить файлы")).toHaveProperty("disabled", false);
  fireEvent.change(screen.getByLabelText("Найти файл"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Вставить static/files/guide.pdf" }));
  expect(insert).toHaveBeenCalledWith("/files/guide.pdf", "static/files/guide.pdf");
  prepareUpload("static/files");
  expect(screen.getByRole("note").textContent).toContain("для каждой локали");
  expect(screen.getByLabelText("Загрузить файлы")).toHaveProperty("disabled", false);
});

it("hides unsupported attachments in DocMedia and rejects them before uploading for insertion", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({
      ...state,
      assets: [{ ...state.assets[0], path: "static/files/guide.pdf", url: "/files/guide.pdf" }],
    }),
  );
  await act(async () => {
    render(
      <MediaLibrary
        projectId="p"
        branch="main"
        document="docs/a.mdx"
        insertionMode="docmedia"
        onInsert={vi.fn()}
      />,
    );
  });
  fireEvent.change(screen.getByLabelText("Найти файл"), { target: { value: "" } });
  expect(screen.queryByRole("link", { name: "Скачать static/files/guide.pdf" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Вставить static/files/guide.pdf" })).toBeNull();
  const calls = vi.mocked(fetch).mock.calls.length;
  await act(async () => {
    fireEvent.drop(screen.getByRole("region", { name: "Загрузка файлов" }), {
      dataTransfer: { files: [new File(["pdf"], "guide.pdf")] },
    });
  });
  expect(screen.getByRole("alert").textContent).toBe("DocMedia поддерживает изображения и MP4.");
  expect(vi.mocked(fetch).mock.calls).toHaveLength(calls);
});

it("inserts only MP4 for Video and rejects images before starting an upload", async () => {
  vi.mocked(fetch).mockResolvedValue(
    Response.json({
      ...state,
      uploadDirectory: "assets/clips/article",
      assets: [
        ...state.assets,
        {
          ...state.assets[0],
          path: "assets/clips/article/demo.MP4",
          url: "/clips/article/demo.MP4",
        },
      ],
    }),
  );
  const insert = vi.fn();
  await act(async () => {
    render(
      <MediaLibrary
        projectId="p"
        branch="main"
        document="docs/article.mdx"
        insertionMode="video"
        onInsert={insert}
      />,
    );
  });
  expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain("mode=video");
  expect(screen.getByLabelText("Папка загрузки")).toHaveProperty("value", "assets/clips/article");
  expect(screen.getByLabelText("Загрузить файлы")).toHaveProperty("accept", ".mp4");
  fireEvent.change(screen.getByLabelText("Найти файл"), { target: { value: "" } });
  expect(screen.queryByRole("button", { name: "Вставить static/img/a.png" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Скачать static/img/a.png" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Вставить assets/clips/article/demo.MP4" }));
  expect(insert).toHaveBeenCalledWith("/clips/article/demo.MP4", "assets/clips/article/demo.MP4");
  const calls = vi.mocked(fetch).mock.calls.length;
  await act(async () => {
    fireEvent.drop(screen.getByRole("region", { name: "Загрузка файлов" }), {
      dataTransfer: { files: [new File(["image"], "a.png")] },
    });
  });
  expect(screen.getByRole("alert").textContent).toBe("Video поддерживает MP4.");
  expect(vi.mocked(fetch).mock.calls).toHaveLength(calls);
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
    prepareUpload();
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
    prepareUpload();
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
    prepareUpload();
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
    prepareUpload();
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
  expect(screen.getByTitle("static/img/a.png")).toBeTruthy();
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
  prepareUpload();
  fireEvent.dragOver(region);
  await act(async () => {
    fireEvent.drop(region, {
      dataTransfer: { files: [new File(["a"], "a.png"), new File(["b"], "b.pdf")] },
    });
  });
  expect(sent.map((item) => item.name)).toEqual(["a.png", "b.pdf"]);
  expect(new URL(sent[0]?.url ?? "", "http://localhost").searchParams.get("path")).toBe(
    "static/img/uploads/a.png",
  );
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
      prepareUpload();
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
  expect(screen.queryByTitle("static/img/a.png")).toBeNull();
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
    prepareUpload();
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

it.each(["markdown", "docmedia", "video"] as const)(
  "prefills and follows the article directory search in %s",
  async (insertionMode) => {
    const extension = insertionMode === "video" ? "mp4" : "png";
    const used = `static/img/article/settings.${extension}`;
    const unrelated = `static/img/article-other/settings.${extension}`;
    const assets = mediaCatalog({
      config: parseProjectConfig(),
      locale: "ru",
      document: "docs/article.mdx",
      paths: [used, unrelated],
      uploads: [],
      files: [],
    });
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ ...state, uploadDirectory: "static/img/article", assets }),
    );
    await act(async () => {
      render(
        <MediaLibrary
          projectId="p"
          branch="main"
          document="docs/article.mdx"
          insertionMode={insertionMode}
        />,
      );
    });
    expect(screen.queryByLabelText("Только в этой статье")).toBeNull();
    expect(screen.getByLabelText("Найти файл")).toHaveProperty("value", "static/img/article");
    expect(screen.getByTitle(used)).toBeTruthy();
    expect(screen.queryByTitle(unrelated)).toBeNull();
    prepareUpload("static/img/article-other");
    expect(screen.getByLabelText("Найти файл")).toHaveProperty("value", "static/img/article-other");
    expect(screen.queryByTitle(used)).toBeNull();
    expect(screen.getByTitle(unrelated)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Найти файл"), { target: { value: "" } });
    expect(screen.getByTitle(used)).toBeTruthy();
  },
);
it.each(["replace", "rename", "skip"])(
  "resolves a same-name media upload with %s",
  async (decision) => {
    const sent: string[] = [];
    class Request extends EventTarget {
      upload = new EventTarget();
      timeout = 0;
      status = 200;
      responseText = "{}";
      open(_method: string, url: string) {
        sent.push(url);
      }
      send() {
        this.dispatchEvent(new Event("load"));
      }
    }
    vi.stubGlobal("XMLHttpRequest", Request);
    vi.mocked(fetch).mockImplementation(async () =>
      Response.json({ ...state, uploadDirectory: "static/img" }),
    );
    await act(async () => {
      render(<MediaLibrary projectId="p" branch="main" document="docs/intro.md" />);
    });
    await act(async () => {
      prepareUpload("static/img");
      fireEvent.change(screen.getByLabelText("Загрузить файлы"), {
        target: { files: [new File(["new"], "a.png")] },
      });
    });
    expect(sent).toHaveLength(0);
    expect(screen.getByRole("alertdialog", { name: "Файл уже существует" })).toBeTruthy();
    expect(screen.getByText(/Файл обновится во всех документах/)).toBeTruthy();
    await act(async () => {
      if (decision === "rename") {
        fireEvent.change(screen.getByRole("textbox", { name: "Новое имя файла" }), {
          target: { value: "b.png" },
        });
        fireEvent.submit(
          screen
            .getByRole("button", { name: "Сохранить под другим именем" })
            .closest("form") as HTMLFormElement,
        );
      } else
        fireEvent.click(
          screen.getByRole("button", {
            name: decision === "replace" ? "Заменить" : "Пропустить",
          }),
        );
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(sent).toHaveLength(decision === "skip" ? 0 : 1);
    if (decision !== "skip") {
      const query = new URL(sent[0] ?? "", "https://local.test").searchParams;
      expect(query.get("path")).toBe(`static/img/${decision === "rename" ? "b" : "a"}.png`);
      expect(query.get("replace")).toBe(String(decision === "replace"));
    }
  },
);
it.each([false, true])(
  "distinguishes a new upload from an uploaded replacement when deleting: inRepository=%s",
  async (inRepository) => {
    let removed = false;
    const asset = { ...state.assets[0], inRepository, status: "upload" };
    vi.mocked(fetch).mockImplementation(async (_url, options) => {
      if (options?.method === "POST") {
        removed = true;
        return Response.json({ saved: true });
      }
      return Response.json({
        ...state,
        assets: removed ? (inRepository ? [{ ...asset, status: "delete" }] : []) : [asset],
      });
    });
    await act(async () => {
      render(<MediaLibrary projectId="p" branch="main" document="docs/intro.md" />);
    });
    fireEvent.click(screen.getByRole("button", { name: "Удалить static/img/a.png" }));
    expect(!!screen.queryByText(/В Git файл останется/)).toBe(inRepository);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Подтвердить удаление" }));
    });
    expect(screen.getByRole("status").textContent).toBe(
      inRepository ? "Файл отмечен для удаления" : "Файл удалён",
    );
    expect(!!screen.queryByRole("button", { name: "Отменить удаление static/img/a.png" })).toBe(
      inRepository,
    );
    expect(screen.queryByRole("region", { name: "Удаление файла" })).toBeNull();
  },
);
