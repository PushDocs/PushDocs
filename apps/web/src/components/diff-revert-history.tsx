"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  moveRevertRange,
  type RevertEdit,
  type RevertedBlock,
  textEdits,
} from "@/lib/diff-revert-state";
import { projectChangesApiPath } from "@/lib/project-paths";
import type { ReviewFile } from "./change-review";

const undoHistory = { limit: 20, failure: "Не удалось вернуть изменения." } as const;
interface RecordEntry {
  path: string;
  token: string;
  revision: number;
  headSha: string;
  previousRevision: number;
  file?: ReviewFile;
  blocks?: { index: number; start: number; end: number }[];
}
interface Entry extends RecordEntry {
  id: string;
  file: ReviewFile;
  blocks: RevertedBlock[];
}
export interface ReviewRevertedBlock extends RevertedBlock {
  error?: string;
  disabled: boolean;
}
interface History {
  canWrite: boolean;
  pending: boolean;
  revision?: number;
  headSha?: string;
  entries: Entry[];
  working: Record<string, ReviewFile>;
  start: () => boolean;
  finish: () => void;
  record: (entry: RecordEntry) => void;
  undo: (id?: string) => void;
  getBlocks: (path: string, content: string) => ReviewRevertedBlock[];
}
const HistoryContext = createContext<History | undefined>(undefined);
export const useDiffRevertHistory = () => useContext(HistoryContext);

export function DiffRevertHistory({
  projectId,
  branch,
  canWrite,
  children,
}: {
  projectId: string;
  branch: string;
  canWrite: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [working, setWorking] = useState<Record<string, ReviewFile>>({});
  const [revision, setRevision] = useState<number>();
  const [headSha, setHeadSha] = useState<string>();
  const [error, setError] = useState<{ id: string; message: string }>();
  const [blocked, setBlocked] = useState(false);
  const start = useCallback(() => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setPending(true);
    return true;
  }, []);
  const finish = useCallback(() => {
    inFlight.current = false;
    setPending(false);
  }, []);
  const record = useCallback(
    (value: RecordEntry) => {
      const continues = revision === value.previousRevision && headSha === value.headSha;
      const id = crypto.randomUUID();
      const file = value.file ?? {
        path: value.path,
        before: "",
        after: "",
        existed: true,
        operation: "modify",
        binary: false,
      };
      const entry = {
        ...value,
        id,
        file,
        blocks: (value.blocks ?? [{ index: 0, start: 0, end: file.after.length }]).map((block) => ({
          ...block,
          id: `${id}:${block.index}`,
        })),
      };
      setEntries((previous) => [...(continues ? previous : []), entry].slice(-undoHistory.limit));
      setWorking((previous) => ({ ...(continues ? previous : {}), [value.path]: file }));
      setRevision(value.revision);
      setHeadSha(value.headSha);
      setError(undefined);
      setBlocked(false);
    },
    [revision, headSha],
  );
  const latest = entries.at(-1);
  const undo = useCallback(
    async (blockId?: string) => {
      const entry = blockId
        ? entries.find((entry) => entry.blocks.some((block) => block.id === blockId))
        : latest;
      if (!canWrite || !entry || blocked || revision === undefined || !start()) return;
      setError(undefined);
      const indexes = blockId
        ? entry.blocks.filter((block) => block.id === blockId).map((block) => block.index)
        : entry.blocks.map((block) => block.index);
      try {
        const response = await fetch(projectChangesApiPath(projectId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            branch,
            path: entry.path,
            expectedRevision: revision,
            expectedHeadSha: entry.headSha,
            restoreToken: entry.token,
            restoreBlocks: indexes,
          }),
        });
        const result = await response.json().catch(() => null);
        if (response.status === 409) setBlocked(true);
        if (!response.ok || !Number.isSafeInteger(result?.revision))
          throw new Error(result?.error || undoHistory.failure);
        setEntries((previous) =>
          previous
            .map((item) => ({
              ...item,
              revision: result.revision,
              blocks:
                item.id === entry.id
                  ? item.blocks.filter((block) => !indexes.includes(block.index))
                  : item.blocks,
            }))
            .filter((item) => item.blocks.length),
        );
        setWorking((previous) => ({
          ...previous,
          [entry.path]: {
            ...(previous[entry.path] ?? entry.file),
            after: result.content ?? "",
            operation: result.content === null ? "delete" : entry.file.existed ? "modify" : "add",
          },
        }));
        setRevision(result.revision);
        router.refresh();
      } catch (error) {
        setError({
          id: entry.id,
          message: error instanceof Error ? error.message : undoHistory.failure,
        });
      } finally {
        finish();
      }
    },
    [projectId, branch, canWrite, entries, latest, revision, blocked, start, finish, router],
  );
  const getBlocks = useCallback(
    (path: string, content: string) =>
      entries
        .filter((entry) => entry.path === path)
        .flatMap((entry) => {
          let changes: RevertEdit[];
          try {
            changes = entry.file.after === content ? [] : textEdits(entry.file.after, content);
          } catch {
            return [];
          }
          return entry.blocks.flatMap((block) => {
            const range = moveRevertRange(block, changes);
            return range
              ? [
                  {
                    ...block,
                    ...range,
                    disabled: pending || blocked || !canWrite,
                    error: error?.id === entry.id ? error.message : undefined,
                  },
                ]
              : [];
          });
        }),
    [entries, pending, blocked, canWrite, error],
  );
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.shiftKey ||
        event.code !== "KeyZ" ||
        !canWrite ||
        !latest ||
        blocked
      )
        return;
      const target = event.target instanceof Element ? event.target : undefined;
      if (
        document.querySelector(".change-revert-confirm") ||
        (target?.closest('input, textarea, [contenteditable]:not([contenteditable="false"])') &&
          !target.closest(".wb-monaco-diff"))
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) void undo();
    };
    document.addEventListener("keydown", keydown, true);
    return () => document.removeEventListener("keydown", keydown, true);
  }, [canWrite, latest, blocked, undo]);
  const value = useMemo(
    () => ({
      canWrite,
      pending,
      revision,
      headSha,
      entries,
      working,
      start,
      finish,
      record,
      undo,
      getBlocks,
    }),
    [
      canWrite,
      pending,
      revision,
      headSha,
      entries,
      working,
      start,
      finish,
      record,
      undo,
      getBlocks,
    ],
  );
  return <HistoryContext.Provider value={value}>{children}</HistoryContext.Provider>;
}

export function DiffRevertEmptyState({ children }: { children: ReactNode }) {
  const history = useDiffRevertHistory();
  return history?.entries.length ? null : children;
}
