"use client";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ChangeFileList } from "./change-file-list";
import { DiffViewer } from "./diff-viewer";
import { RevertFile } from "./revert-file";
export interface ReviewFile {
  path: string;
  operation: string;
  before: string;
  after: string;
  binary: boolean;
  existed: boolean;
}
export function ChangeReview({
  projectId,
  branch,
  files,
  revertContext,
}: {
  projectId: string;
  branch: string;
  files: ReviewFile[];
  revertContext?: { revision: number; ownerId: string; canEditConfig: boolean };
}) {
  const [selectedPath, setSelectedPath] = useState(files[0]?.path);
  const [query, setQuery] = useState("");
  const filteredFiles = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return search ? files.filter((file) => file.path.toLocaleLowerCase().includes(search)) : files;
  }, [files, query]);
  const selected = Math.max(
    0,
    filteredFiles.findIndex((file) => file.path === selectedPath),
  );
  const file = filteredFiles[selected];
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
            files={filteredFiles}
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
                <Link
                  href={`/projects/${projectId}/documents?${new URLSearchParams({ branch, path: file.path })}`}
                >
                  Открыть файл
                </Link>
                {revertContext &&
                (file.path !== ".pushdocs/config.json" || revertContext.canEditConfig) ? (
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
                        {/\.(png|jpe?g|gif|webp|avif|svg)$/i.test(file.path) ? (
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
            ) : (
              <DiffViewer
                path={file.path}
                key={file.path}
                before={file.before}
                after={file.after}
              />
            )}
          </>
        ) : null}
      </div>
    </section>
  );
}
