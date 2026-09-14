// @vitest-environment jsdom

import { parseProjectConfig } from "@pushdocs/content";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  explorer: {} as Record<string, (...args: never[]) => unknown>,
  preview: {} as Record<string, (...args: never[]) => unknown>,
  quickOpen: {} as Record<string, (...args: never[]) => unknown>,
  replace: {} as Record<string, (...args: never[]) => unknown>,
  replaceSelection: vi.fn(),
  router: { push: vi.fn(), refresh: vi.fn() },
  backgroundSync: vi.fn(),
  start: vi.fn(),
  status: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("next/link", () => ({ default: (props: Record<string, unknown>) => <a {...props} /> }));
vi.mock("@/app/actions", () => ({
  startBackgroundBranchSyncAction: mocks.backgroundSync,
  startGitOperationAction: mocks.start,
  gitOperationStatusAction: mocks.status,
}));
vi.mock("@pushdocs/ui", () => ({
  SearchableSelect: ({ label }: { label: string }) => <button type="button">{label}</button>,
  Select: ({ label }: { label: string }) => <select aria-label={label} />,
}));
vi.mock("./explorer-upload", () => ({ uploadExplorerFiles: mocks.upload }));
vi.mock("./file-explorer", () => ({
  ExplorerFileIcon: () => <span>file</span>,
  FileExplorer: (props: typeof mocks.explorer) => {
    mocks.explorer = props;
    return <div data-testid="explorer" />;
  },
}));
vi.mock("./document-preview", () => ({
  DocumentPreview: (props: typeof mocks.preview) => {
    mocks.preview = props;
    return <div data-testid="preview" />;
  },
}));
vi.mock("./quick-open", () => ({
  QuickOpen: (props: typeof mocks.quickOpen) => {
    mocks.quickOpen = props;
    return <div data-testid="quick-open" />;
  },
}));
vi.mock("./replace-preview", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./replace-preview")>()),
  ReplacePreview: (props: typeof mocks.replace) => {
    mocks.replace = props;
    return <div data-testid="replace-preview" />;
  },
}));
vi.mock("./media-library", () => ({ MediaLibrary: () => <div data-testid="media" /> }));
vi.mock("./file-comments", () => ({ FileComments: () => <div data-testid="comments" /> }));
vi.mock("./source-editor", () => ({
  SourceEditor: ({ inputRef }: { inputRef: { current: unknown } }) => {
    inputRef.current = { replaceSelection: mocks.replaceSelection };
    return <div data-testid="source" />;
  },
}));

import { Workbench, type WorkbenchState } from "./workbench";

let state: WorkbenchState;
beforeEach(() => {
  mocks.backgroundSync.mockResolvedValue(null);
  mocks.start.mockResolvedValue("job");
  mocks.status.mockResolvedValue({ status: "failed" });
  mocks.upload.mockRejectedValue(new Error("upload failed"));
  vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  state = {
    files: [
      {
        path: "docs/a.md",
        title: "A",
        content: "# A",
        baseContent: "# A",
        locale: "default",
        version: "current",
        status: "clean",
      },
    ],
    uploads: [{ path: "static/img/asset.png" }],
    revision: 0,
    status: "open",
    sha: "head",
    branches: [{ full_ref: "main" }],
    role: "editor",
    repositoryPaths: ["docs/a.md", "remote.md"],
    config: parseProjectConfig(),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      const address = String(url);
      if (address.includes("file-statuses")) return Response.json({ sha: "head", statuses: {} });
      if (address.includes("search=")) return Response.json({ results: undefined });
      if (address.includes("path=remote.md"))
        return Response.json({ error: "remote failed" }, { status: 503 });
      return Response.json(state);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function mount() {
  render(<Workbench projectId="project" projectName="Docs" branch="main" initial={state} />);
}

it("executes explorer callbacks for permissions, copy, upload, and media", async () => {
  mount();
  await act(async () => {});
  expect(mocks.explorer.canEdit?.("docs/a.md" as never)).toBe(true);
  expect(mocks.explorer.canEdit?.("static/img/asset.png" as never)).toBe(false);
  await act(async () => mocks.explorer.onAction?.("copy" as never, "docs/a.md" as never));
  expect(screen.getByRole("status").textContent).toContain("Путь скопирован");
  fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));

  await act(async () =>
    mocks.explorer.onUpload?.([new File(["x"], "x.md")] as never, "docs" as never),
  );
  expect(screen.getByRole("status").textContent).toContain("upload failed");
  fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
  await act(async () => mocks.explorer.onMedia?.());
  expect(screen.getByTestId("media")).toBeTruthy();
});

it("routes preview errors, formatting, remote search, and failed remote opens", async () => {
  mount();
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Заголовок" }));
  expect(mocks.replaceSelection).toHaveBeenCalled();

  fireEvent.click(screen.getByRole("tab", { name: "Просмотр" }));
  await act(async () => mocks.preview.onErrorLine?.(12 as never));
  expect(screen.getByRole("tab", { name: "Файл" }).getAttribute("aria-selected")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Файл и просмотр рядом" }));
  await act(async () => mocks.preview.onErrorLine?.(8 as never));

  fireEvent.click(screen.getByRole("button", { name: /Найти файл/ }));
  await expect(
    mocks.quickOpen.onSearchContent?.("needle" as never, new AbortController().signal as never),
  ).resolves.toEqual([]);
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({ error: "search failed" }, { status: 500 }),
  );
  await expect(
    mocks.quickOpen.onSearchContent?.("needle" as never, new AbortController().signal as never),
  ).rejects.toThrow("search failed");
  await act(async () => mocks.quickOpen.onOpen?.("remote.md" as never, 4 as never));
  expect(screen.getByRole("alert").textContent).toContain("remote failed");
});

it("keeps stale replacement previews and exposes a failed attachment copy as text", async () => {
  vi.stubGlobal("navigator", {
    clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
  });
  render(
    <Workbench
      projectId="project"
      projectName="Docs"
      branch="main"
      initial={state}
      initialPath="static/img/asset.png"
    />,
  );
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Копировать ссылку" }));
  expect((await screen.findByRole("status")).textContent).toContain("/img/asset.png");
  cleanup();
  sessionStorage.clear();

  mount();
  await act(async () => {});
  fireEvent.change(screen.getByLabelText("Найти текст"), { target: { value: "A" } });
  fireEvent.change(screen.getByLabelText("Заменить на"), { target: { value: "B" } });
  fireEvent.click(screen.getByRole("button", { name: "Просмотреть замены" }));
  expect(screen.getByTestId("replace-preview")).toBeTruthy();
  await act(async () => mocks.replace.onApply?.("stale" as never, "changed" as never));
  expect(screen.getByTestId("replace-preview")).toBeTruthy();
});
