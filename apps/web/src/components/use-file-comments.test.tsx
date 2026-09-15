// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useFileComments } from "./use-file-comments";

const first = { id: "1", body: "First", author_name: "Anna", unread: true };
let comments = [first];
let visible = "visible";
const read = vi.fn();
function Harness({ active = false, path = "docs/a.md" }: { active?: boolean; path?: string }) {
  const state = useFileComments({ projectId: "project", branch: "main", path, active });
  return (
    <>
      <output aria-label="Непрочитанные">{state.unreadCount}</output>
      <p>{state.comments.map((comment) => comment.body).join(",")}</p>
      <p>{state.error}</p>
      <button type="button" onClick={() => void state.refresh()}>
        Refresh
      </button>
    </>
  );
}
const dispatch = (
  detail: unknown = {
    projectId: "project",
    payload: { branch: "main", documentPath: "docs/a.md" },
  },
) => window.dispatchEvent(new CustomEvent("pushdocs:refresh", { detail }));
async function mount(active = false) {
  let view: ReturnType<typeof render> | undefined;
  await act(async () => {
    view = render(<Harness active={active} />);
  });
  if (!view) throw new Error("Missing view");
  return view;
}
beforeEach(() => {
  vi.useFakeTimers();
  comments = [{ ...first }];
  visible = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(
    () => visible as DocumentVisibilityState,
  );
  read.mockReset().mockImplementation(async (ids: string[]) => {
    comments = comments.map((comment) =>
      ids.includes(comment.id) ? { ...comment, unread: false } : comment,
    );
    return Response.json({ readIds: ids });
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, options) =>
      options?.method === "PATCH"
        ? read(JSON.parse(String(options.body)).commentIds)
        : Response.json(comments),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("counts unread comments while the panel is closed and updates immediately on matching realtime events", async () => {
  await mount();
  expect(screen.getByLabelText("Непрочитанные").textContent).toBe("1");
  expect(read).not.toHaveBeenCalled();
  comments = [
    ...comments,
    { ...first, id: "2", body: "New" },
    { ...first, id: "own", body: "Own", unread: false },
  ];
  await act(async () => {
    dispatch();
  });
  expect(screen.getByLabelText("Непрочитанные").textContent).toBe("2");
  comments = comments.map((comment) => ({ ...comment, unread: false }));
  await act(async () => {
    dispatch({ type: "comments.read", projectId: null, payload: { projectId: "project" } });
  });
  expect(screen.getByLabelText("Непрочитанные").textContent).toBe("0");
});

it("marks exactly loaded messages when opened, and marks new arrivals while the visible panel stays open", async () => {
  const view = await mount();
  await act(async () => {
    view.rerender(<Harness active />);
  });
  expect(read).toHaveBeenCalledWith(["1"]);
  expect(screen.getByLabelText("Непрочитанные").textContent).toBe("0");
  comments.push({ ...first, id: "2", body: "New" });
  await act(async () => {
    dispatch();
  });
  expect(read).toHaveBeenLastCalledWith(["2"]);
  expect(screen.getByLabelText("Непрочитанные").textContent).toBe("0");
  expect(fetch).toHaveBeenCalledWith(
    "/api/projects/project/comments",
    expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ branch: "main", path: "docs/a.md", commentIds: ["2"] }),
    }),
  );
});

it("does not mark an open panel read in a background tab, and catches up when the tab becomes visible", async () => {
  visible = "hidden";
  await mount(true);
  expect(read).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Непрочитанные").textContent).toBe("1");
  visible = "visible";
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(read).toHaveBeenCalledWith(["1"]);
});

it("ignores events outside the file and refreshes after reconnect, focus and the recovery interval", async () => {
  await mount();
  for (const detail of [
    { projectId: "other" },
    { projectId: null, payload: { projectId: "other" } },
    { payload: { branch: "other" } },
    { payload: { documentPath: "other" } },
  ])
    dispatch(detail);
  expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => {
    window.dispatchEvent(new Event("online"));
  });
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30000);
  });
  await act(async () => {
    window.dispatchEvent(
      new CustomEvent("pushdocs:realtime-connected", { detail: { projectId: "project" } }),
    );
  });
  expect(fetch).toHaveBeenCalledTimes(5);
  cleanup();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30000);
  });
  expect(fetch).toHaveBeenCalledTimes(5);
});

it("retries failed read receipts without clearing the unread count prematurely", async () => {
  read.mockResolvedValueOnce(new Response(null, { status: 503 }));
  await mount(true);
  expect(screen.getByLabelText("Непрочитанные").textContent).toBe("1");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(read).toHaveBeenCalledTimes(2);
  expect(screen.getByLabelText("Непрочитанные").textContent).toBe("0");
});

it("cancels failed read retries when the panel closes", async () => {
  read.mockResolvedValueOnce(new Response(null, { status: 503 }));
  const view = await mount(true);
  await act(async () => {
    view.rerender(<Harness />);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(read).toHaveBeenCalledTimes(1);
});

it("ignores old file responses after switching documents and resets the counter immediately", async () => {
  let release: (response: Response) => void = () => undefined;
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const view = await mount();
  comments = [];
  await act(async () => {
    view.rerender(<Harness path="docs/b.md" />);
  });
  await act(async () => {
    release(Response.json([first]));
  });
  expect(screen.getByLabelText("Непрочитанные").textContent).toBe("0");
  expect(screen.queryByText("First")).toBeNull();
});

it("does not let a delayed pre-read GET restore the unread count", async () => {
  const view = await mount();
  let release: (response: Response) => void = () => undefined;
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await act(async () => {
    fireEvent.click(screen.getByText("Refresh"));
  });
  await act(async () => {
    view.rerender(<Harness active />);
  });
  await act(async () => {
    release(Response.json([first]));
  });
  expect(screen.getByLabelText("Непрочитанные").textContent).toBe("0");
});

it("keeps the last known count after a failed refresh and recovers on the next event", async () => {
  await mount();
  vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 }));
  await act(async () => {
    dispatch();
  });
  expect(screen.getByLabelText("Непрочитанные").textContent).toBe("1");
  expect(screen.getByText(/Комментарии недоступны/)).toBeTruthy();
  await act(async () => {
    dispatch();
  });
  expect(screen.queryByText(/Комментарии недоступны/)).toBeNull();
});

it("retains a new arrival from an in-flight GET when the preceding comment is marked read", async () => {
  const view = await mount();
  let release: (response: Response) => void = () => undefined;
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await act(async () => {
    fireEvent.click(screen.getByText("Refresh"));
  });
  await act(async () => {
    view.rerender(<Harness active />);
  });
  await act(async () => {
    release(Response.json([first, { ...first, id: "2", body: "Arrived while reading" }]));
  });
  expect(screen.getByText(/Arrived while reading/)).toBeTruthy();
  expect(read).toHaveBeenLastCalledWith(["2"]);
});
