export async function logoutAction() {}

export async function startBackgroundBranchSyncAction(): Promise<null> {
  return null;
}

export async function synchronizeBranchAction(data: FormData): Promise<string | null> {
  const response = await fetch("/fixture/git/start", {
    method: "POST",
    body: JSON.stringify(Object.fromEntries(data)),
  });
  if (!response.ok) throw new Error("Start failed");
  return (await response.json()).id;
}

async function unsupportedConflictAction(): Promise<never> {
  throw new Error("Conflict actions require the branch-conflicts fixture");
}

export {
  unsupportedConflictAction as cancelRebaseUpdateAction,
  unsupportedConflictAction as inspectReviewConflictsAction,
  unsupportedConflictAction as prepareConflictResolutionAction,
  unsupportedConflictAction as retryConflictResolutionAction,
  unsupportedConflictAction as submitConflictResolutionAction,
};

export async function startGitOperationAction(input: {
  projectId: string;
  branch: string;
  mergeDefault?: boolean;
  reviewsOnly?: boolean;
  title?: string;
}): Promise<string> {
  const response = await fetch("/fixture/git/start", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error("Start failed");
  return (await response.json()).id;
}

export async function gitOperationStatusAction(projectId: string, jobId: string) {
  const response = await fetch(`/fixture/git/status?${new URLSearchParams({ projectId, jobId })}`);
  if (!response.ok) throw new Error("Status failed");
  return response.json();
}
