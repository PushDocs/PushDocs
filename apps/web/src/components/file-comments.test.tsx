// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FileComments } from "./file-comments";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation(async () =>
        Response.json([{ id: "1", body: "Замечание", author_name: "Анна" }]),
      ),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
async function mount() {
  await act(async () => {
    render(<FileComments projectId="project" branch="docs/new" path="docs/a.md" />);
  });
}
it("loads and polls comments in the chosen branch", async () => {
  await mount();
  expect(screen.getByText("Замечание")).toBeTruthy();
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining("branch=docs%2Fnew&path=docs%2Fa.md"),
    expect.any(Object),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("posts a comment and clears input only after success", async () => {
  await mount();
  fireEvent.change(screen.getByLabelText("Новый комментарий"), { target: { value: "Ответ" } });
  await act(async () => {
    fireEvent.click(screen.getByText("Отправить комментарий"));
  });
  expect(fetch).toHaveBeenCalledWith(
    "/api/projects/project/comments",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ branch: "docs/new", path: "docs/a.md", body: "Ответ" }),
    }),
  );
  expect(screen.getByLabelText("Новый комментарий")).toHaveProperty("value", "");
});
it("preserves a comment rejected by the server", async () => {
  await mount();
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: "Нет доступа" }, { status: 403 }));
  fireEvent.change(screen.getByLabelText("Новый комментарий"), { target: { value: "Ответ" } });
  await act(async () => {
    fireEvent.click(screen.getByText("Отправить комментарий"));
  });
  expect(screen.getByRole("alert").textContent).toContain("Нет доступа");
  expect(screen.getByLabelText("Новый комментарий")).toHaveProperty("value", "Ответ");
});
it("shows network errors and cancels requests on unmount", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 }));
  await mount();
  expect(screen.getByRole("alert").textContent).toContain("Комментарии недоступны");
  const signal = vi.mocked(fetch).mock.calls[0]?.[1]?.signal;
  cleanup();
  expect(signal?.aborted).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20000);
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([false, true])("ignores a late request after unmount (failure %s)", async (failure) => {
  let release: (response: Response) => void = () => undefined;
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await mount();
  cleanup();
  await act(async () => {
    release(failure ? new Response(null, { status: 503 }) : Response.json([]));
  });
  expect(screen.queryByRole("alert")).toBeNull();
});
