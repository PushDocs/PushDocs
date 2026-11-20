"use client";

import { useCallback, useEffect, useState } from "react";
import { listLocalDrafts } from "./draft-storage";

export function useLocalDraftChanges(
  projectId: string,
  ownerId: string,
  branch: string,
  currentBranch = branch,
) {
  return useLocalDraftState(projectId, ownerId, branch, currentBranch).hasChanges;
}

export function useLocalDraftState(
  projectId: string,
  ownerId: string,
  branch: string,
  currentBranch = branch,
) {
  const [hasChanges, setHasChanges] = useState(false);
  const refresh = useCallback(
    () => setHasChanges(listLocalDrafts(projectId, [branch, currentBranch], ownerId).length > 0),
    [projectId, ownerId, branch, currentBranch],
  );
  useEffect(() => {
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);
  return { hasChanges, refresh };
}
