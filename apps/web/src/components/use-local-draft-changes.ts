"use client";

import { useEffect, useState } from "react";
import { listLocalDrafts } from "./draft-storage";

export function useLocalDraftChanges(
  projectId: string,
  ownerId: string,
  branch: string,
  currentBranch = branch,
) {
  const [hasChanges, setHasChanges] = useState(false);
  useEffect(() => {
    const update = () =>
      setHasChanges(listLocalDrafts(projectId, [branch, currentBranch], ownerId).length > 0);
    update();
    window.addEventListener("storage", update);
    window.addEventListener("focus", update);
    return () => {
      window.removeEventListener("storage", update);
      window.removeEventListener("focus", update);
    };
  }, [projectId, ownerId, branch, currentBranch]);
  return hasChanges;
}
