"use client";

import type { BranchConflictResolution } from "@pushdocs/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ConflictDrafts } from "./branch-conflict-editor";
import type { ConflictInspectionTask } from "./conflict-inspection";

const fragmentDraftVersion = 1;

export function useConflictResolutionDrafts(
  { ownerId, projectId, reviewId }: { ownerId: string; projectId: string; reviewId: string },
  inspection: ConflictInspectionTask["inspection"],
) {
  const context = inspection?.snapshot.rebase;
  const storageKey = `pushdocs:merge-resolution:${JSON.stringify([ownerId, projectId, reviewId, ...(context ? [context.operationId, context.conflictId] : [])])}`;
  const [choices, setChoices] = useState<Record<string, BranchConflictResolution[number]>>({});
  const [fragments, setFragments] = useState<ConflictDrafts>({});
  const currentInspection = useRef<string>(undefined);
  const revision = inspection
    ? `${inspection.id}:${inspection.snapshot.rebase?.conflictId ?? "merge"}`
    : undefined;
  const [loadedRevision, setLoadedRevision] = useState<string>();

  useEffect(() => {
    if (!inspection || currentInspection.current === revision) return;
    currentInspection.current = revision;
    let saved = {};
    let savedFragments = {};
    try {
      const cached = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      if (
        cached?.parentSha === inspection.snapshot.parentSha &&
        cached?.sourceSha === inspection.snapshot.sourceSha
      ) {
        saved = cached.choices;
        if (cached.fragmentDraftVersion === fragmentDraftVersion) savedFragments = cached.fragments;
      }
    } catch {
      /* Optional browser storage. */
    }
    setChoices(saved || {});
    setFragments(savedFragments || {});
    setLoadedRevision(revision);
  }, [inspection, storageKey, revision]);

  function choose(
    path: string,
    value: BranchConflictResolution[number] | undefined,
    fileFragments?: ConflictDrafts[string],
  ) {
    const next = { ...choices };
    if (value) next[path] = value;
    else delete next[path];
    const nextFragments = { ...fragments };
    if (fileFragments) nextFragments[path] = fileFragments;
    else delete nextFragments[path];
    setChoices(next);
    setFragments(nextFragments);
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          parentSha: inspection?.snapshot.parentSha,
          sourceSha: inspection?.snapshot.sourceSha,
          choices: next,
          fragments: nextFragments,
          fragmentDraftVersion,
        }),
      );
    } catch {
      /* The visible result remains available for submission. */
    }
  }

  const clear = useCallback(() => {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* Optional browser storage. */
    }
  }, [storageKey]);

  const ready = Boolean(inspection && loadedRevision === revision);
  return { choices: ready ? choices : {}, fragments: ready ? fragments : {}, choose, clear, ready };
}
