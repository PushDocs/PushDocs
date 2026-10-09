import { expect, it } from "vitest";
import { type PreviewRuntimeStatus, previewLifecycle } from "./preview";

const workspace = {
  deleted: false,
  delete_requested: false,
  preparation_status: "starting" as const,
  ready_at: new Date("2026-10-09T10:00:00Z"),
};

it.each(["queued", "starting", "stopped", "failed"] as const)(
  "ignores stale workspace preparation %s when the site has stopped",
  (preparation_status) => {
    expect(
      previewLifecycle({
        session: { desired_state: "stopped", status: "stopped" },
        workspace: { ...workspace, preparation_status },
        contentCurrent: true,
      }),
    ).toEqual({ status: "deployed", runtimeStatus: "stopped", canOpen: false });
  },
);

it.each(["queued", "starting", "ready", "failed", "stopped"] as PreviewRuntimeStatus[])(
  "deletion takes precedence over runtime %s",
  (status) => {
    expect(
      previewLifecycle({
        session: { desired_state: "running", status },
        workspace: { ...workspace, delete_requested: true },
        contentCurrent: true,
      }),
    ).toEqual({ status: "deleting", runtimeStatus: "deleting", canOpen: false });
  },
);

it("does not mistake partial files for completed preparation", () => {
  expect(
    previewLifecycle({
      workspace: { ...workspace, preparation_status: "stopped", ready_at: null },
      contentCurrent: true,
    }),
  ).toMatchObject({ status: "stopped", canOpen: false });
});

it("shows queued recovery and prevents opening outdated content", () => {
  expect(
    previewLifecycle({
      session: { desired_state: "running", status: "stopped" },
      workspace,
      contentCurrent: true,
    }),
  ).toMatchObject({ status: "queued", canOpen: false });
  expect(
    previewLifecycle({
      session: { desired_state: "running", status: "ready" },
      workspace,
      contentCurrent: false,
    }),
  ).toEqual({ status: "updating", runtimeStatus: "starting", canOpen: false });
  expect(
    previewLifecycle({
      session: { desired_state: "running", status: "ready" },
      workspace,
      contentCurrent: true,
    }),
  ).toEqual({ status: "ready", runtimeStatus: "ready", canOpen: true });
});

it("shows preparation of an existing workspace as updating and shutdown as stopping", () => {
  expect(previewLifecycle({ workspace, contentCurrent: true })).toMatchObject({
    status: "updating",
  });
  expect(
    previewLifecycle({
      session: { desired_state: "stopped", status: "ready" },
      workspace,
      contentCurrent: true,
    }),
  ).toEqual({ status: "stopping", runtimeStatus: "stopped", canOpen: false });
});
