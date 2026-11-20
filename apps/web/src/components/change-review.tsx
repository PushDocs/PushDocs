"use client";
import { projectConfigPaths } from "@pushdocs/contracts";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { projectDocumentLineHref } from "@/lib/project-paths";
import { ChangeFileKind, changeFileKind, groupChangedFiles } from "./change-file-groups";
import { ChangeFileList } from "./change-file-list";
import { DiffViewer } from "./diff-viewer";
import { RevertDiff } from "./revert-diff";
import { RevertFile } from "./revert-file";
export interface ReviewFile {
  path: string;
  operation: string;
  before: string;
  after: string;
  binary: boolean;
  existed: boolean;
  baseKnown?: boolean;
}
export function ChangeReview({
  projectId,
  branch,
  files,
  revertContext,
  initialPath,
  initialQuery = "",
  initialLine,
}: {
  projectId: string;
  branch: string;
  files: ReviewFile[];
  revertContext?: { revision: number; headSha: string; ownerId: string; canEditConfig: boolean };
  initialPath?: string;
  initialQuery?: string;
  initialLine?: number;
}) {
  const groups = useMemo(() => groupChangedFiles(files), [files]);
  const [selectedPath, setSelectedPath] = useState(() => initialPath ?? groups[0]?.files[0]?.path);
  const [query, setQuery] = useState(initialQuery);
  const filteredGroups = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return search
      ? groups
          .map((group) => ({
            ...group,
            files: group.files.filter((file) => file.path.toLocaleLowerCase().includes(search)),
          }))
          .filter((group) => group.files.length > 0)
      : groups;
  }, [groups, query]);
  const filteredFiles = useMemo(
    () => filteredGroups.flatMap((group) => group.files),
    [filteredGroups],
  );
  const selected = Math.max(
    0,
    filteredFiles.findIndex((file) => file.path === selectedPath),
  );
  const file = filteredFiles[selected];
  const canRevert =
    revertContext && (file?.path !== projectConfigPaths.config || revertContext.canEditConfig);
  const lineHref = useCallback(
    (line: number) => projectDocumentLineHref(projectId, branch, file?.path ?? "", line, query),
    [projectId, branch, file?.path, query],
  );
  if (!files.length) return null;
  const asset = (version?: string) =>
    `/api/projects/${projectId}/assets?${new URLSearchParams({ branch, path: file?.path ?? "", ...(version ? { version } : {}) })}`;
  const selectOffset = (offset: number) => {
    const target = filteredFiles[selected + offset];
    if (target) setSelectedPath(target.path);
  };
  return (
    <section className="changes-files change-review" aria-label="Проверка изменений">
      <aside className="change-review-sidebar" aria-label="Навигация по изменениям">
        <header>
          <strong>Файлы</strong>
          <span>{query ? `${filteredFiles.length} / ${files.length}` : files.length}</span>
        </header>
        <label className="change-file-search">
          <Search aria-hidden size={15} />
          <input
            aria-label="Найти изменённый файл"
            placeholder="Найти файл…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            type="search"
          />
        </label>
        {filteredFiles.length ? (
          <ChangeFileList
            key={query}
            groups={filteredGroups}
            selectedPath={file?.path}
            onSelect={setSelectedPath}
          />
        ) : (
          <p className="change-review-empty" role="status">
            Файлы не найдены
          </p>
        )}
      </aside>
      <div className="change-review-detail">
        {file ? (
          <>
            <header className="change-review-heading">
              <strong title={file.path}>{file.path}</strong>
              <div>
                <button
                  type="button"
                  aria-label="Предыдущий файл"
                  title="Предыдущий файл"
                  disabled={selected === 0}
                  onClick={() => selectOffset(-1)}
                >
                  <ChevronLeft aria-hidden size={16} />
                </button>
                <span>
                  {selected + 1} / {filteredFiles.length}
                </span>
                <button
                  type="button"
                  aria-label="Следующий файл"
                  title="Следующий файл"
                  disabled={selected >= filteredFiles.length - 1}
                  onClick={() => selectOffset(1)}
                >
                  <ChevronRight aria-hidden size={16} />
                </button>
                <Link href={lineHref(initialPath === file.path ? (initialLine ?? 1) : 1)}>
                  Открыть файл
                </Link>
                {revertContext && canRevert ? (
                  <RevertFile
                    key={`${branch}:${file.path}:${revertContext.revision}`}
                    projectId={projectId}
                    branch={branch}
                    path={file.path}
                    existed={file.existed}
                    operation={file.operation}
                    revision={revertContext.revision}
                    ownerId={revertContext.ownerId}
                  />
                ) : null}
              </div>
            </header>
            {file.binary ? (
              <div className="change-images">
                {[true, false].map((before) => (
                  <figure key={String(before)}>
                    <figcaption>{before ? "Версия из Git" : "Ваши изменения"}</figcaption>
                    {(before && !file.existed) || (!before && file.operation === "delete") ? (
                      <p>{before ? "Файла не было" : "Файл удалён"}</p>
                    ) : (
                      <>
                        {changeFileKind(file.path) === ChangeFileKind.Image ? (
                          // biome-ignore lint/performance/noImgElement: authenticated draft and Git versions
                          <img
                            alt={before ? "До изменения" : "После изменения"}
                            src={asset(before ? "git" : undefined)}
                          />
                        ) : null}
                        <a
                          href={asset(before ? "git" : undefined)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Открыть версию файла
                        </a>
                      </>
                    )}
                  </figure>
                ))}
              </div>
            ) : revertContext && canRevert && file.baseKnown !== false ? (
              <RevertDiff
                key={`${branch}:${file.path}:${revertContext.revision}`}
                projectId={projectId}
                branch={branch}
                path={file.path}
                before={file.before}
                after={file.after}
                revision={revertContext.revision}
                headSha={revertContext.headSha}
                ownerId={revertContext.ownerId}
                lineHref={file.operation !== "delete" ? lineHref : undefined}
                revealLine={initialPath === file.path ? initialLine : undefined}
              />
            ) : (
              <DiffViewer
                path={file.path}
                key={file.path}
                before={file.before}
                after={file.after}
                lineHref={file.operation !== "delete" ? lineHref : undefined}
                revealLine={initialPath === file.path ? initialLine : undefined}
              />
            )}
          </>
        ) : null}
      </div>
    </section>
  );
}
