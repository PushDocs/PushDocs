// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useBranchFreshness } from "./use-branch-freshness";

const initialProps = {
  projectId: "project",
  branch: "docs/task",
  headSha: "installed",
  remoteHeadSha: "installed",
  defaultBranch: "stable",
};
const current = {
  remoteSha: "installed",
  defaultBranch: "stable",
  defaultHeadSha: "stable-head",
  includesDefaultBranch: true,
};
const sync = (branch: string, projectId = "project") =>
  window.dispatchEvent(
    new CustomEvent("pushdocs:refresh", {
      detail: { type: "branch.synchronized", projectId, payload: { branch } },
    }),
  );

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it.each(["installed", "new-head", null])(
  "checks head %j once on entry without polling",
  async (remoteSha) => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation(async () => Response.json({ ...current, remoteSha }));
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(useBranchFreshness, { initialProps });
    expect(result.current.filesCurrent).toBeNull();
    await act(async () => {});
    expect(result.current.filesCurrent).toBe(remoteSha === null ? null : remoteSha === "installed");
    expect(result.current.remoteMissing).toBe(remoteSha === null);
    expect(result.current.includesDefaultBranch).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      "/api/projects/project/branch-freshness?branch=docs%2Ftask",
      expect.objectContaining({ cache: "no-store" }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000);
      window.dispatchEvent(new Event("focus"));
    });
    expect(fetch).toHaveBeenCalledOnce();
  },
);

it.each([true, false, null])(
  "keeps source ancestry %j separate from imported files",
  async (includesDefaultBranch) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ ...current, includesDefaultBranch })),
    );
    const { result } = renderHook(useBranchFreshness, { initialProps });
    await act(async () => {});
    expect(result.current.filesCurrent).toBe(true);
    expect(result.current.includesDefaultBranch).toBe(includesDefaultBranch);
  },
);

it.each(["network", "http", "invalid"])(
  "keeps freshness unknown on %s failure and allows a manual recheck",
  async (failure) => {
    const fetch = vi.fn();
    if (failure === "network") fetch.mockRejectedValueOnce(new Error("offline"));
    else if (failure === "http") fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
    else fetch.mockResolvedValueOnce(Response.json({ error: "unknown" }));
    fetch.mockImplementation(async () => Response.json(current));
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(useBranchFreshness, { initialProps });
    await act(async () => {});
    expect(result.current.filesCurrent).toBeNull();
    expect(result.current.includesDefaultBranch).toBeNull();
    expect(result.current.checking).toBe(false);
    expect(result.current.remoteMissing).toBe(false);
    await act(async () => result.current.refresh());
    expect(result.current.filesCurrent).toBe(true);
    expect(result.current.includesDefaultBranch).toBe(true);
  },
);

it("rechecks when synchronized heads or source branches change", async () => {
  const fetch = vi.fn().mockImplementation(async () => Response.json(current));
  vi.stubGlobal("fetch", fetch);
  const { result, rerender } = renderHook(useBranchFreshness, { initialProps });
  await act(async () => {});
  expect(result.current.filesCurrent).toBe(true);
  await act(async () => {
    sync("other");
    sync("docs/task", "other-project");
  });
  expect(fetch).toHaveBeenCalledOnce();
  fetch.mockImplementation(async () => Response.json({ ...current, includesDefaultBranch: false }));
  await act(async () => sync("stable"));
  expect(result.current.includesDefaultBranch).toBe(false);
  fetch.mockImplementation(async () => Response.json({ ...current, remoteSha: "new-head" }));
  rerender({ ...initialProps, remoteHeadSha: "new-head" });
  expect(result.current.filesCurrent).toBeNull();
  await act(async () => {});
  expect(result.current.filesCurrent).toBe(false);
  rerender({ ...initialProps, headSha: "new-head", remoteHeadSha: "new-head" });
  await act(async () => {});
  expect(result.current.filesCurrent).toBe(true);
});

it("ignores a late response for old heads after another editor synchronizes the branch", async () => {
  let finish: ((response: Response) => void) | undefined;
  const fetch = vi
    .fn()
    .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
    .mockImplementation(async () => Response.json({ ...current, remoteSha: "new-head" }));
  vi.stubGlobal("fetch", fetch);
  const { result, rerender, unmount } = renderHook(useBranchFreshness, { initialProps });
  rerender({ ...initialProps, headSha: "new-head", remoteHeadSha: "new-head" });
  await act(async () => {});
  await act(async () => finish?.(Response.json({ ...current, remoteSha: "old-head" })));
  expect(result.current.filesCurrent).toBe(true);
  expect(fetch.mock.calls[0]?.[1].signal.aborted).toBe(true);
  unmount();
  expect(fetch.mock.calls[1]?.[1].signal.aborted).toBe(true);
});

it("rechecks an unchanged SHA after a completed synchronization", async () => {
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockImplementation(async () => Response.json(current));
  vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(useBranchFreshness, { initialProps });
  await act(async () => {});
  expect(result.current.filesCurrent).toBeNull();
  await act(async () => sync("docs/task"));
  expect(result.current.filesCurrent).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("checks switched branches and projects but does not check review-only operations", async () => {
  const fetch = vi.fn().mockImplementation(async () => Response.json(current));
  vi.stubGlobal("fetch", fetch);
  const { rerender } = renderHook(useBranchFreshness, { initialProps });
  await act(async () => {});
  rerender({ ...initialProps, branch: "other" });
  await act(async () => {});
  rerender({ ...initialProps, branch: "other", projectId: "other-project" });
  await act(async () => {});
  expect(fetch).toHaveBeenCalledTimes(3);
  const { result } = renderHook(() => useBranchFreshness({ ...initialProps, enabled: false }));
  expect(result.current.filesCurrent).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(3);
});
