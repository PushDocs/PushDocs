export type PreviewRuntimeStatus = "queued" | "starting" | "ready" | "failed" | "stopped";
export const browserPreviewIdleTtlMs = 3_600_000;

export function previewLifecycle(input: {
  session?: { desired_state: "running" | "stopped"; status: PreviewRuntimeStatus };
  workspace?: {
    deleted: boolean;
    delete_requested: boolean;
    preparation_status: "queued" | "starting" | "stopped" | "failed";
    ready_at: Date | string | null;
  };
  contentCurrent: boolean;
}) {
  const { session, workspace, contentCurrent } = input;
  if (workspace?.delete_requested)
    return { status: "deleting", runtimeStatus: "deleting", canOpen: false } as const;
  if (workspace?.deleted)
    return { status: "stopped", runtimeStatus: "stopped", canOpen: false } as const;
  if (session?.desired_state === "running") {
    const runtimeStatus = session.status === "stopped" ? "queued" : session.status;
    if (runtimeStatus === "ready" && !contentCurrent)
      return { status: "updating", runtimeStatus: "starting", canOpen: false } as const;
    return { status: runtimeStatus, runtimeStatus, canOpen: runtimeStatus === "ready" } as const;
  }
  if (session) {
    return {
      status:
        session.status !== "stopped" ? "stopping" : workspace?.ready_at ? "deployed" : "stopped",
      runtimeStatus: "stopped",
      canOpen: false,
    } as const;
  }
  const preparation = workspace?.preparation_status ?? "queued";
  return {
    status:
      preparation === "stopped"
        ? workspace?.ready_at
          ? "deployed"
          : "stopped"
        : preparation === "starting" && workspace?.ready_at
          ? "updating"
          : preparation,
    runtimeStatus: "stopped",
    canOpen: false,
  } as const;
}
