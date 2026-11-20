import { z } from "zod";
import type { BranchUpdatePolicy } from "./branch-update";

export const branchConflictLimits = {
  files: 200,
  textBytes: 1_000_000,
  snapshotBytes: 8_000_000,
  actionBytes: 16_000_000,
  pollMs: 2000,
  progressMs: 1000,
  clientCacheMs: 60_000,
} as const;

export enum ConflictInspectionStage {
  Preparing = "preparing-conflicts",
  Fetching = "fetching-conflicts",
  Comparing = "comparing-conflicts",
  Reading = "reading-conflicts",
  Finalizing = "finalizing-conflicts",
}

export interface GitTransferProgress {
  receivedBytes: number;
  totalBytes: number | null;
}

export const branchConflictCache = { version: 6, entries: 20 } as const;

export enum ConflictReportMode {
  Editorial = "editorial",
  Detailed = "detailed",
}

/** Conflict analysis never needs image/video/archive bytes, including formats not offered by uploads. */
export function isConflictMediaFile(filePath: string) {
  return /\.(png|jpe?g|gif|webp|avif|svg|apng|bmp|ico|tiff?|heic|pdf|zip|mp4|webm|mov|m4v|avi|mkv|mpeg|mpg|mp3|wav|ogg|m4a)$/i.test(
    filePath,
  );
}

export const conflictReportLimits = {
  files: 5,
  fragments: 5,
  excerptChars: 2000,
  contextChars: 1500,
  fileChars: 20_000,
  referenceDocs: 100,
  referenceBytes: 2_000_000,
  references: 20,
  titleChars: 300,
} as const;

export function branchConflictRepositoryKey(target: {
  connection_id: string;
  base_url: string;
  provider_repository_id: string;
  clone_url: string;
  kind: string;
  root_path: string;
}) {
  return JSON.stringify([
    target.connection_id,
    target.base_url,
    target.provider_repository_id,
    target.clone_url,
    target.kind,
    target.root_path,
  ]);
}

export enum BranchConflictChoice {
  Ours = "ours",
  Theirs = "theirs",
  Manual = "manual",
}

export const branchConflictResolutionSchema = z
  .array(
    z.object({
      path: z.string().min(1).max(1000),
      choice: z.enum(BranchConflictChoice),
      content: z.string().max(branchConflictLimits.textBytes).optional(),
    }),
  )
  .max(branchConflictLimits.files)
  .refine(
    (files) =>
      files.reduce(
        (total, file) => total + new TextEncoder().encode(file.content ?? "").length,
        0,
      ) <= branchConflictLimits.snapshotBytes,
    "Ручной результат превышает допустимый размер",
  );

export type BranchConflictResolution = z.infer<typeof branchConflictResolutionSchema>;

export type BranchConflictSection =
  | { kind: "text"; content: string }
  | { kind: "conflict"; ours: string; theirs: string; base: string };

export interface BranchConflictFile {
  path: string;
  kind: "text" | "binary" | "unsupported";
  oursExists: boolean;
  theirsExists: boolean;
  baseContent: string | null;
  oursContent: string | null;
  theirsContent: string | null;
  mediaReferences?: {
    complete: boolean;
    articles: Array<{ version: "branch" | "target"; path: string; title: string }>;
  };
  sections?: BranchConflictSection[];
  versions?: {
    base: { mode: string; sha: string } | null;
    ours: { mode: string; sha: string } | null;
    theirs: { mode: string; sha: string } | null;
  };
}

export interface BranchConflictSnapshot {
  merge?: { operationId: string; conflictId: string };
  rebase?: {
    operationId: string;
    conflictId: string;
    commitSha: string;
    currentParentSha: string;
    originalParentSha: string;
    index: number;
    total: number;
    title: string;
  };
  updatePolicy?: BranchUpdatePolicy;
  inspectionVersion?: number;
  mediaContentsSkipped?: boolean;
  branch: string;
  sourceBranch: string;
  parentSha: string;
  sourceSha: string;
  history?: {
    base: { sha: string; committedAt: string | null };
    branch: { sha: string; committedAt: string | null };
    target: { sha: string; committedAt: string | null };
  };
  files: BranchConflictFile[];
  unsupportedReason?: string;
}

export function hasBranchConflicts(reason: string | null | undefined) {
  return reason === "conflict" || reason === "dirty";
}
