// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/actions", () => ({
  startGitOperationAction: vi.fn(),
  gitOperationStatusAction: vi.fn(),
}));

import { startGitOperationAction } from "@/app/actions";
import { BranchOperations } from "./branch-operations";
import { GitOperation } from "./git-operation";

afterEach(cleanup);

it.each(["changes", "documents"])(
  "replaces a completed check with a missing remote status on %s",
  async (page) => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          remoteSha: null,
          defaultBranch: "stable",
          defaultHeadSha: "base",
          includesDefaultBranch: null,
        }),
      });
    vi.stubGlobal("fetch", fetch);
    const props = {
      projectId: "project",
      branch: "docs/done",
      headSha: "merged-head",
      defaultBranch: "stable",
    };
    render(
      page === "changes" ? (
        <GitOperation {...props} />
      ) : (
        <BranchOperations
          {...props}
          canMerge
          disabled={false}
          beforeStart={async () => true}
          onComplete={async () => {}}
        />
      ),
    );
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Проверить обновления" }));
    await act(async () => {});
    expect(screen.getByRole("status").textContent).toBe("Ветка удалена из Git");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText("Обновить ветку…")).toBeNull();
    expect(startGitOperationAction).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(2);
  },
);
