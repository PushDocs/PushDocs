// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  sync: vi.fn(),
  router: { refresh: vi.fn() },
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/app/actions", () => ({
  gitOperationStatusAction: mocks.status,
  synchronizeBranchAction: mocks.sync,
}));

import { BranchImport, ProjectBranchImportProgress } from "./branch-import";
import { branchImportStore } from "./branch-import-store";

afterEach(() => {
  cleanup();
  branchImportStore.clear();
  vi.useRealTimers();
  mocks.router.refresh.mockReset();
  mocks.status.mockReset();
  mocks.sync.mockReset();
});

it("starts once in StrictMode, keeps a compact loader and refreshes once on completion", async () => {
  vi.useFakeTimers();
  mocks.sync.mockResolvedValue("job");
  mocks.status
    .mockResolvedValueOnce({ status: "queued" })
    .mockResolvedValueOnce({ status: "done" });
  const view = render(
    <StrictMode>
      <ProjectBranchImportProgress projectId="project" ownerId="user" hidden />
      <BranchImport projectId="project" branch="docs/fix #1" />
    </StrictMode>,
  );
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(mocks.sync).toHaveBeenCalledTimes(1);
  expect(Object.fromEntries(mocks.sync.mock.calls[0]?.[0] ?? [])).toEqual({
    projectId: "project",
    branch: "docs/fix #1",
  });
  const progress = screen.getByRole("status", { name: "Загрузка файлов ветки" });
  expect(progress.getAttribute("aria-busy")).toBe("true");
  expect(progress.querySelector("svg.spin")).toBeTruthy();
  expect(view.container.querySelector(".section-skeleton")).toBeNull();
  expect(mocks.status).toHaveBeenCalledWith("project", "job");
  expect(mocks.router.refresh).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(mocks.status).toHaveBeenCalledTimes(2);
  expect(mocks.router.refresh).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status")).toBe(progress);
});

it.each([
  { totalBytes: null, expected: "Получаем файлы… (загружено 12,5 МБ)" },
  { totalBytes: 25_000_000, expected: "Получаем файлы… (загружено 12,5 из 25,0 МБ)" },
])("updates downloaded MB from job polling: $expected", async ({ totalBytes, expected }) => {
  vi.useFakeTimers();
  mocks.sync.mockResolvedValue("job");
  mocks.status
    .mockResolvedValueOnce({
      status: "running",
      transferProgress: { receivedBytes: 0, totalBytes: null },
    })
    .mockResolvedValueOnce({
      status: "running",
      transferProgress: { receivedBytes: 12_500_000, totalBytes },
    })
    .mockResolvedValueOnce({ status: "queued" });
  render(<BranchImport projectId="project" branch="docs/update" />);
  await act(async () => {});
  const progress = screen.getByRole("status", { name: "Загрузка файлов ветки" });
  expect(progress.textContent).toBe("Получаем файлы… (загружено 0,0 МБ)");
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(progress.textContent).toBe(expected);
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(progress.textContent).toBe("Ожидаем загрузку…");
});

it("keeps polling after leaving and immediately restores the latest amount on return", async () => {
  vi.useFakeTimers();
  mocks.sync.mockResolvedValue("job");
  mocks.status
    .mockResolvedValueOnce({
      status: "running",
      transferProgress: { receivedBytes: 12_500_000, totalBytes: null },
    })
    .mockResolvedValueOnce({
      status: "running",
      transferProgress: { receivedBytes: 18_000_000, totalBytes: null },
    })
    .mockResolvedValue({ status: "done" });
  const first = render(<BranchImport projectId="project" branch="docs/update" />);
  await act(async () => {});
  first.unmount();
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  render(<BranchImport projectId="project" branch="docs/update" />);
  expect(screen.getByRole("status").textContent).toBe("Получаем файлы… (загружено 18,0 МБ)");
  expect(mocks.sync).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(mocks.router.refresh).toHaveBeenCalledTimes(1);
});

it("finishes away from the page and opens the completed import on return without scheduling work", async () => {
  vi.useFakeTimers();
  mocks.sync.mockResolvedValue("job");
  mocks.status.mockResolvedValueOnce({ status: "running" }).mockResolvedValue({ status: "done" });
  const first = render(<BranchImport projectId="project" branch="docs/update" />);
  await act(async () => {});
  first.unmount();
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(mocks.router.refresh).not.toHaveBeenCalled();
  render(<BranchImport projectId="project" branch="docs/update" />);
  expect(screen.getByRole("status").textContent).toBe("Открываем документы…");
  expect(mocks.router.refresh).toHaveBeenCalledTimes(1);
  expect(mocks.sync).toHaveBeenCalledTimes(1);
});

it("restores the same pending start request after navigation", async () => {
  let finish: ((jobId: string) => void) | undefined;
  mocks.sync.mockReturnValue(
    new Promise<string>((resolve) => {
      finish = resolve;
    }),
  );
  mocks.status.mockResolvedValue({ status: "running" });
  const first = render(<BranchImport projectId="project" branch="docs/update" />);
  first.unmount();
  await act(async () => finish?.("job"));
  render(<BranchImport projectId="project" branch="docs/update" />);
  expect(screen.getByRole("status").textContent).toBe("Получаем файлы…");
  expect(mocks.sync).toHaveBeenCalledTimes(1);
});

it("shows progress in another section and hides completed tasks", async () => {
  vi.useFakeTimers();
  mocks.sync.mockResolvedValue("job");
  mocks.status
    .mockResolvedValueOnce({
      status: "running",
      transferProgress: { receivedBytes: 12_500_000, totalBytes: null },
    })
    .mockResolvedValue({ status: "done" });
  const view = render(
    <>
      <ProjectBranchImportProgress projectId="project" ownerId="user" hidden />
      <BranchImport projectId="project" branch="docs/update" />
    </>,
  );
  await act(async () => {});
  view.rerender(<ProjectBranchImportProgress projectId="project" ownerId="user" />);
  const background = screen.getByRole("complementary", { name: "Фоновые загрузки веток" });
  expect(within(background).getByRole("status").textContent).toContain("12,5 МБ");
  expect(
    within(background).getByRole("link", { name: "Открыть документы" }).getAttribute("href"),
  ).toBe("/projects/project/documents?branch=docs%2Fupdate");
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(screen.queryByRole("complementary")).toBeNull();
  expect(mocks.sync).toHaveBeenCalledTimes(1);
});

it("keeps the server task after five minutes and retains MB while the network is unavailable", async () => {
  vi.useFakeTimers();
  mocks.sync.mockResolvedValue("job");
  mocks.status.mockResolvedValue({
    status: "running",
    transferProgress: { receivedBytes: 12_500_000, totalBytes: null },
  });
  render(<BranchImport projectId="project" branch="docs/update" />);
  await act(async () => vi.advanceTimersByTimeAsync(300_000));
  mocks.status.mockRejectedValueOnce(new Error("offline"));
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("12,5 МБ");
  expect(screen.getByText("Нет связи с сервером. Проверяем загрузку…")).toBeTruthy();
  expect(mocks.sync).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(screen.queryByText("Нет связи с сервером. Проверяем загрузку…")).toBeNull();
});

it("clears the previous amount only after an explicit retry of a failed import", async () => {
  vi.useFakeTimers();
  mocks.sync.mockResolvedValueOnce("job").mockReturnValueOnce(new Promise(() => {}));
  mocks.status
    .mockResolvedValueOnce({
      status: "running",
      transferProgress: { receivedBytes: 12_500_000, totalBytes: null },
    })
    .mockResolvedValueOnce({ status: "failed" });
  const view = render(<BranchImport projectId="project" branch="docs/update" />);
  await act(async () => {});
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  view.unmount();
  render(<BranchImport projectId="project" branch="docs/update" />);
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(mocks.sync).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Повторить загрузку" }));
  await act(async () => {});
  expect(screen.getByRole("status").textContent).toBe("Подготавливаем загрузку…");
  expect(mocks.sync).toHaveBeenCalledTimes(2);
});

it("opens an already imported branch without polling", async () => {
  mocks.sync.mockResolvedValue(null);
  render(<BranchImport projectId="project" branch="docs/update" />);
  await act(async () => {});
  expect(mocks.status).not.toHaveBeenCalled();
  expect(mocks.router.refresh).toHaveBeenCalledTimes(1);
});

it("offers an explicit retry when starting the job fails", async () => {
  mocks.sync.mockRejectedValueOnce(new Error("offline")).mockResolvedValue("job");
  mocks.status.mockResolvedValue({ status: "queued" });
  render(<BranchImport projectId="project" branch="docs/update" />);
  expect(await screen.findByRole("alert")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Повторить загрузку" }));
  await act(async () => {});
  expect(mocks.sync).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("explains a missing branch without exposing raw provider errors", async () => {
  mocks.sync.mockResolvedValue("job");
  mocks.status.mockResolvedValue({ status: "failed", last_error: "Branch doc/790 was not found" });
  render(<BranchImport projectId="project" branch="doc/790" />);
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Ветка doc/790 не найдена в подключённом репозитории",
  );
});

it.each([
  'Provider request failed with 401: {"error":"invalid_token","error_description":"Token was revoked. You have to re-authorize from the user."}',
  "Provider request failed with 401: private response",
])(
  "explains a rejected repository token without exposing provider details: %s",
  async (lastError) => {
    mocks.sync.mockResolvedValue("job");
    mocks.status.mockResolvedValue({ status: "failed", last_error: lastError });
    render(<BranchImport projectId="project" branch="doc/814" />);
    const message = (await screen.findByRole("alert")).textContent;
    expect(message).toContain("токен доступа к репозиторию недействителен или отозван");
    expect(message).toContain("Обновите access token в «Настройки → Подключения»");
    expect(message).toContain("затем повторите загрузку");
    expect(message).not.toContain(lastError);
    expect(message).not.toContain("private response");
    expect(screen.getByRole("button", { name: "Повторить загрузку" })).toBeTruthy();
  },
);

it.each([403, 500])(
  "does not display arbitrary provider error bodies for HTTP %s",
  async (status) => {
    mocks.sync.mockResolvedValue("job");
    mocks.status.mockResolvedValue({
      status: "failed",
      last_error: `Provider request failed with ${status}: private response`,
    });
    render(<BranchImport projectId="project" branch="main" />);
    const message = (await screen.findByRole("alert")).textContent;
    expect(message).toContain("Проверьте доступ подключения PushDocs");
    expect(message).not.toContain("токен");
    expect(message).not.toContain("private response");
  },
);
