"use client";

import { useCallback, useEffect, useState } from "react";
import { defaultFileSearchOptions, type FileSearchOptions } from "@/lib/file-search";

export enum WorkbenchSidebar {
  Files = "files",
  Search = "search",
}

export interface FileSearchState extends FileSearchOptions {
  query: string;
  content: boolean;
  scrollTop: number;
}

interface WorkbenchSearchState extends FileSearchState {
  panel: WorkbenchSidebar;
}

export const defaultFileSearchState: FileSearchState = {
  ...defaultFileSearchOptions,
  query: "",
  content: true,
  scrollTop: 0,
};

const defaultWorkbenchSearchState: WorkbenchSearchState = {
  ...defaultFileSearchState,
  panel: WorkbenchSidebar.Files,
};

export function useWorkbenchSearch(ownerId: string | undefined, projectId: string, branch: string) {
  const storageKey = `pushdocs:search:${JSON.stringify([ownerId ?? "", projectId, branch])}`;
  const [stored, setStored] = useState<{ key: string; value: WorkbenchSearchState }>();
  const search = stored?.key === storageKey ? stored.value : defaultWorkbenchSearchState;

  useEffect(() => {
    let value = defaultWorkbenchSearchState;
    try {
      const restored = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
      if (
        restored &&
        typeof restored.query === "string" &&
        typeof restored.content === "boolean" &&
        Number.isFinite(restored.scrollTop) &&
        restored.scrollTop >= 0 &&
        Object.values(WorkbenchSidebar).includes(restored.panel)
      ) {
        value = {
          query: restored.query,
          content: restored.content,
          scrollTop: restored.scrollTop,
          panel: restored.panel,
          matchCase: restored.matchCase === true,
          wholeWord: restored.wholeWord === true,
        };
      }
    } catch {}
    setStored({ key: storageKey, value });
  }, [storageKey]);

  useEffect(() => {
    if (stored?.key !== storageKey) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(stored.value));
    } catch {}
  }, [storageKey, stored]);

  const updateSearch = useCallback(
    (update: Partial<WorkbenchSearchState>) => {
      setStored((current) => ({
        key: storageKey,
        value: {
          ...(current?.key === storageKey ? current.value : defaultWorkbenchSearchState),
          ...update,
        },
      }));
    },
    [storageKey],
  );

  return { search, updateSearch };
}
