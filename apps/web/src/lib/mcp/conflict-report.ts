import { readMetadata } from "@pushdocs/content/metadata";
import {
  BranchConflictChoice,
  type BranchConflictFile,
  type BranchConflictResolution,
  type BranchConflictSnapshot,
  branchConflictLimits,
  ConflictReportMode,
  conflictReportLimits,
  isConflictMediaFile,
} from "@pushdocs/contracts";
import { McpError } from "@pushdocs/db";
import { z } from "zod";

export const conflictResolutionInput = z
  .array(
    z.object({
      path: z.string().min(1).max(1000),
      choice: z.enum(["branch", "target", "combine"]),
      fragments: z
        .array(
          z.object({
            index: z.number().int().nonnegative(),
            choice: z.enum(["branch", "target", "manual"]),
            content: z.string().max(branchConflictLimits.textBytes).optional(),
          }),
        )
        .optional(),
    }),
  )
  .max(branchConflictLimits.files);

export interface ConflictReportLinks {
  appOrigin: string;
  repositoryUrl: string;
  provider: "github" | "gitlab";
  projectId: string;
  rootPath: string;
  reviewUrl: string;
}

const encodePath = (value: string) => value.split("/").map(encodeURIComponent).join("/");

export function conflictFileUrl(links: ConflictReportLinks, sha: string, filePath: string) {
  return `${links.repositoryUrl.replace(/\/$/, "")}/${links.provider === "gitlab" ? "-/blob" : "blob"}/${encodeURIComponent(sha)}/${encodePath(filePath)}`;
}

function excerpt(content: string | null, limit: number) {
  return {
    text: content === null ? null : content.slice(0, limit),
    truncated: content !== null && content.length > limit,
  };
}

function articleTitle(content: string, fallback: string) {
  try {
    const title = readMetadata(content).values.title;
    if (typeof title === "string" && title.trim())
      return title.slice(0, conflictReportLimits.titleChars);
  } catch {
    // Unsupported frontmatter must not hide the conflict itself.
  }
  return (content.match(/^#\s+(.+)$/m)?.[1] ?? fallback).slice(0, conflictReportLimits.titleChars);
}

function articleContext(content: string, fragment: string) {
  const at = fragment ? content.indexOf(fragment) : 0;
  const offset = Math.max(0, at);
  const preceding = content.slice(0, offset);
  const heading = [...preceding.matchAll(/^#{1,6}\s+(.+)$/gm)].at(-1)?.[1] ?? null;
  const locationAmbiguous = at < 0 || (!!fragment && content.indexOf(fragment, offset + 1) >= 0);
  return {
    heading,
    line: locationAmbiguous ? null : preceding.split("\n").length,
    before: preceding.slice(-conflictReportLimits.contextChars),
    after: content.slice(
      offset + fragment.length,
      offset + fragment.length + conflictReportLimits.contextChars,
    ),
    locationAmbiguous,
  };
}

export function conflictReport(
  snapshot: BranchConflictSnapshot,
  links: ConflictReportLinks,
  input: {
    mode: ConflictReportMode;
    offset: number;
    limit: number;
    path?: string;
    fragmentOffset: number;
    referenceOffset?: number;
  },
) {
  const files = input.path
    ? snapshot.files.filter((file) => file.path === input.path)
    : snapshot.files;
  if (input.path && !files.length)
    throw new McpError("FILE_NOT_FOUND", "Conflict file not found.", 404);
  const limit = input.mode === ConflictReportMode.Detailed ? 1 : input.limit;
  const textLimit =
    input.mode === ConflictReportMode.Detailed
      ? conflictReportLimits.fileChars
      : conflictReportLimits.excerptChars;
  const root = links.rootPath === "." ? "" : `${links.rootPath.replace(/^\/+|\/+$/g, "")}/`;
  return {
    mode: input.mode,
    comparisonKind: "merge",
    reviewUrl: links.reviewUrl,
    branch: snapshot.branch,
    targetBranch: snapshot.sourceBranch,
    versions: snapshot.history ?? null,
    dateMeaning:
      "Committer dates identify the compared versions, not the date a paragraph changed or a PR was merged. Do not infer chronology from dates.",
    mediaPolicy: "metadata_only",
    unsupportedReason: snapshot.unsupportedReason ?? null,
    total: files.length,
    totalConflicts: snapshot.files.length,
    nextCursor: input.offset + limit < files.length ? String(input.offset + limit) : null,
    items: files.slice(input.offset, input.offset + limit).map((file) => {
      const media = isConflictMediaFile(file.path) || file.kind === "binary";
      const relative = file.path.startsWith(root) ? file.path.slice(root.length) : file.path;
      const content = file.oursContent ?? file.theirsContent ?? file.baseContent ?? "";
      const title = media ? relative : articleTitle(content, relative);
      const fragments = file.sections?.filter((section) => section.kind === "conflict") ?? [];
      return {
        path: file.path,
        title,
        kind: file.kind,
        editorUrl:
          media || file.kind === "unsupported"
            ? null
            : new URL(
                `/projects/${encodeURIComponent(links.projectId)}/documents?${new URLSearchParams({ branch: snapshot.branch, path: relative })}`,
                links.appOrigin,
              ).toString(),
        links: {
          base:
            snapshot.history && (file.versions ? !!file.versions.base : file.baseContent !== null)
              ? conflictFileUrl(links, snapshot.history.base.sha, file.path)
              : null,
          branch: file.oursExists ? conflictFileUrl(links, snapshot.parentSha, file.path) : null,
          target: file.theirsExists ? conflictFileUrl(links, snapshot.sourceSha, file.path) : null,
        },
        facts: {
          baseExists: file.versions ? !!file.versions.base : file.baseContent !== null,
          branchExists: file.oursExists,
          targetExists: file.theirsExists,
          branchChanged: changed(file, "ours"),
          targetChanged: changed(file, "theirs"),
          type:
            file.kind === "unsupported"
              ? "unsupported"
              : !file.oursExists || !file.theirsExists
                ? "modify_delete"
                : !(file.versions ? file.versions.base : file.baseContent !== null)
                  ? "add_add"
                  : "both_modified",
        },
        ...(media
          ? {
              media: {
                contentInspected: false,
                versions: file.versions ?? null,
                referencesChecked: file.mediaReferences?.complete ?? false,
                referenceScope: "static_links_in_document_roots",
                referenceTotal: file.mediaReferences?.articles.length ?? 0,
                nextReferenceCursor:
                  (input.referenceOffset ?? 0) + conflictReportLimits.references <
                  (file.mediaReferences?.articles.length ?? 0)
                    ? String((input.referenceOffset ?? 0) + conflictReportLimits.references)
                    : null,
                references:
                  file.mediaReferences?.articles
                    .slice(
                      input.referenceOffset ?? 0,
                      (input.referenceOffset ?? 0) + conflictReportLimits.references,
                    )
                    .map((article) => ({
                      ...article,
                      title: article.title.slice(0, conflictReportLimits.titleChars),
                      url: conflictFileUrl(
                        links,
                        article.version === "branch" ? snapshot.parentSha : snapshot.sourceSha,
                        article.path,
                      ),
                    })) ?? [],
                note: "Only file identities and presence were compared. Contents, pixels and frames were not inspected. File references must be checked separately; absence of a reference list does not mean unused.",
              },
            }
          : {
              fragmentTotal: fragments.length,
              nextFragmentCursor:
                input.fragmentOffset + conflictReportLimits.fragments < fragments.length
                  ? String(input.fragmentOffset + conflictReportLimits.fragments)
                  : null,
              fragments: fragments
                .slice(input.fragmentOffset, input.fragmentOffset + conflictReportLimits.fragments)
                .map((section, index) => {
                  const context = {
                    base: articleContext(file.baseContent ?? "", section.base),
                    branch: articleContext(file.oursContent ?? "", section.ours),
                    target: articleContext(file.theirsContent ?? "", section.theirs),
                  };
                  const fragmentLink = (
                    sha: string | undefined,
                    exists: boolean,
                    line: number | null,
                  ) =>
                    sha && exists
                      ? `${conflictFileUrl(links, sha, file.path)}${line ? `#L${line}` : ""}`
                      : null;
                  return {
                    index: input.fragmentOffset + index,
                    base: excerpt(section.base, textLimit),
                    branch: excerpt(section.ours, textLimit),
                    target: excerpt(section.theirs, textLimit),
                    branchChanged: section.ours !== section.base,
                    targetChanged: section.theirs !== section.base,
                    context,
                    links: {
                      base: fragmentLink(
                        snapshot.history?.base.sha,
                        file.baseContent !== null,
                        context.base.line,
                      ),
                      branch: fragmentLink(
                        snapshot.parentSha,
                        file.oursExists,
                        context.branch.line,
                      ),
                      target: fragmentLink(
                        snapshot.sourceSha,
                        file.theirsExists,
                        context.target.line,
                      ),
                    },
                  };
                }),
              ...(!fragments.length
                ? {
                    base: excerpt(file.baseContent, textLimit),
                    branch: excerpt(file.oursContent, textLimit),
                    target: excerpt(file.theirsContent, textLimit),
                  }
                : {}),
              fullTextTool: "get_conflict_file",
            }),
      };
    }),
  };
}

function changed(file: BranchConflictFile, side: "ours" | "theirs") {
  if (file.versions) return file.versions.base?.sha !== file.versions[side]?.sha;
  return file.baseContent !== (side === "ours" ? file.oursContent : file.theirsContent);
}

/** Stitch the original clean merge sections server-side, never from an abbreviated report. */
export function conflictResolutions(
  snapshot: BranchConflictSnapshot,
  input: z.infer<typeof conflictResolutionInput>,
): BranchConflictResolution {
  return input.map((decision) => {
    const file = snapshot.files.find((file) => file.path === decision.path);
    if (!file) throw new McpError("INVALID_ARGUMENT", "Unknown conflict file.");
    if (decision.choice !== "combine") {
      if (decision.fragments?.length)
        throw new McpError("INVALID_ARGUMENT", "Fragments require combine.");
      if (file.kind === "text" && !isConflictMediaFile(file.path) && file.sections) {
        return {
          path: decision.path,
          choice: BranchConflictChoice.Manual,
          content: file.sections
            .map((section) =>
              section.kind === "text"
                ? section.content
                : decision.choice === "branch"
                  ? section.ours
                  : section.theirs,
            )
            .join(""),
        };
      }
      return {
        path: decision.path,
        choice:
          decision.choice === "branch" ? BranchConflictChoice.Ours : BranchConflictChoice.Theirs,
      };
    }
    if (file.kind !== "text" || isConflictMediaFile(file.path) || !file.sections)
      throw new McpError("INVALID_ARGUMENT", "This file requires choosing a complete version.");
    const fragments = file.sections.filter((section) => section.kind === "conflict");
    const choices = new Map(decision.fragments?.map((fragment) => [fragment.index, fragment]));
    if (
      choices.size !== fragments.length ||
      decision.fragments?.length !== fragments.length ||
      [...choices.keys()].some((index) => index >= fragments.length)
    )
      throw new McpError("INVALID_ARGUMENT", "Choose a result for every conflict fragment.");
    let index = 0;
    const content = file.sections
      .map((section) => {
        if (section.kind === "text") return section.content;
        const choice = choices.get(index++);
        if (!choice) throw new McpError("INVALID_ARGUMENT", "Missing fragment decision.");
        if (choice.choice === "manual") {
          if (choice.content === undefined)
            throw new McpError("INVALID_ARGUMENT", "Manual fragment text is required.");
          return choice.content;
        }
        return choice.choice === "branch" ? section.ours : section.theirs;
      })
      .join("");
    return { path: decision.path, choice: BranchConflictChoice.Manual, content };
  });
}
