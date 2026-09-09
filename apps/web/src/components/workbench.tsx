"use client";

import { applyEditorInput } from "@pushdocs/content/editing";
import type { ProjectConfig } from "@pushdocs/contracts";
import {
  ArrowRight,
  Bold,
  Check,
  ChevronDown,
  Eye,
  GitBranch,
  Heading2,
  MessageSquare,
  MoreHorizontal,
  Puzzle,
  RefreshCw,
  Save,
  Settings2,
  Table2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DiffViewer } from "./diff-viewer";
import { DocumentPreview } from "./document-preview";
import { FileComments } from "./file-comments";
import { ExplorerFileIcon, FileExplorer } from "./file-explorer";
import { fileStatusLabel, mergeFileStatuses } from "./file-status";
import { MediaLibrary } from "./media-library";
import { MetadataEditor } from "./metadata-editor";
import { SourceEditor } from "./source-editor";

export interface WorkingFile {
  path: string;
  content: string;
  baseContent: string;
  title: string;
  locale: string;
  version: string;
  status: string;
}
export interface WorkbenchState {
  files: WorkingFile[];
  uploads?: Array<{ path: string }>;
  revision: number;
  status: string;
  sha: string;
  repositoryPaths: string[];
  config: ProjectConfig;
  branches: Array<{ full_ref: string; is_protected?: boolean }>;
  role: string;
  changeSetId?: string;
}
type Dialog = "folder" | "new" | "branch" | "move" | "delete" | "template" | "media" | null;

export function Workbench({
  projectId,
  projectName,
  branch,
  initial,
  initialPath,
  initialPanel,
  components = [],
}: {
  projectId: string;
  projectName: string;
  branch: string;
  initial: WorkbenchState;
  initialPath?: string;
  initialPanel?: "media";
  components?: Array<{ label: string; snippet: string }>;
}) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const stateRef = useRef(initial);
  const firstPath =
    (initialPath &&
    (initial.repositoryPaths.includes(initialPath) ||
      initial.uploads?.some((file) => file.path === initialPath))
      ? initialPath
      : undefined) ??
    initial.files.find((file) => file.path === initialPath)?.path ??
    initial.files.find((file) => /\.mdx?$/.test(file.path) && !file.path.startsWith("i18n/"))
      ?.path ??
    initial.files[0]?.path ??
    "";
  const [selected, setSelected] = useState(firstPath);
  const [tabs, setTabs] = useState<string[]>(firstPath ? [firstPath] : []);
  const sessionKey = `pushdocs:tabs:${projectId}:${branch}`;
  const initialSession = useRef({ initial, firstPath, initialPath });
  const [text, setText] = useState(
    initial.files.find((file) => file.path === firstPath)?.content ?? "",
  );
  const saved = useRef(text);
  const latest = useRef(text);
  const textArea = useRef<HTMLTextAreaElement>(null);
  const modal = useRef<HTMLElement>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [branchQuery, setBranchQuery] = useState("");
  const [createDirectory, setCreateDirectory] = useState("");
  const [revealDirectory, setRevealDirectory] = useState("");
  const [branchStatuses, setBranchStatuses] = useState<Record<string, string>>({});
  const [statusError, setStatusError] = useState("");
  const [remoteFiles, setRemoteFiles] = useState<Record<string, string | null>>({});
  const opening = useRef(0);
  const [mode, setMode] = useState<"source" | "preview" | "diff" | "metadata">("source");
  const [dialog, setDialog] = useState<Dialog>(initialPanel ?? null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const mediaBusyRef = useRef(false);
  mediaBusyRef.current = mediaBusy;
  const [error, setError] = useState("");
  const [needsMerge, setNeedsMerge] = useState(false);
  const blocked = useRef(false);
  const [component, setComponent] = useState(components[0]?.snippet ?? "");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [plan, setPlan] = useState<Array<{ path: string; content: string }> | null>(null);
  const [templateInput, setTemplateInput] = useState<Record<string, unknown> | null>(null);
  const [replace, setReplace] = useState("");
  const [replacement, setReplacement] = useState("");
  const endpoint = `/api/projects/${projectId}/workbench`;
  const projectReadOnly = state.role === "reader" || state.status !== "open";
  const uploaded = state.uploads?.some((file) => file.path === selected) ?? false;
  const active = state.files.find(
    (file) => file.path === selected && (!uploaded || file.status === "delete"),
  );
  const article =
    active && /\.mdx?$/i.test(selected)
      ? selected
      : ([...tabs].reverse().find((path) => /\.mdx?$/i.test(path)) ??
        state.files.find((file) => /\.mdx?$/i.test(file.path) && file.status !== "delete")?.path ??
        "");
  const readOnly = projectReadOnly || !active;
  const explorerPaths = useMemo(
    () => [
      ...new Set([
        ...state.repositoryPaths,
        ...state.files.map((file) => file.path),
        ...(state.uploads ?? []).map((file) => file.path),
        ...Object.keys(branchStatuses),
      ]),
    ],
    [state.repositoryPaths, state.files, state.uploads, branchStatuses],
  );
  const dirty = text !== saved.current;
  const fileStatuses = useMemo(() => {
    const statuses = mergeFileStatuses(branchStatuses, state.files);
    for (const { path } of state.uploads ?? []) {
      if (statuses.get(path) !== "delete")
        statuses.set(
          path,
          statuses.get(path) === "add" || !state.repositoryPaths.includes(path) ? "add" : "modify",
        );
    }
    if (dirty && selected && statuses.get(selected) !== "add") statuses.set(selected, "modify");
    return statuses;
  }, [state.files, state.uploads, state.repositoryPaths, branchStatuses, dirty, selected]);
  useEffect(() => {
    const controller = new AbortController();
    const update = async () => {
      try {
        const response = await fetch(
          `/api/projects/${projectId}/file-statuses?${new URLSearchParams({ branch, revision: String(state.revision) })}`,
          { signal: controller.signal },
        );
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        if (controller.signal.aborted || result.sha !== state.sha) return;
        setBranchStatuses(result.statuses ?? {});
        setStatusError("");
      } catch {
        if (!controller.signal.aborted) {
          setBranchStatuses({});
          setStatusError(
            "Не удалось получить изменения из Git. Показаны только локальные изменения.",
          );
        }
      }
    };
    void update();
    const timer = setInterval(() => void update(), 30_000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [projectId, branch, state.sha, state.revision]);
  latest.current = text;

  useEffect(() => {
    try {
      const cached = JSON.parse(sessionStorage.getItem(sessionKey) ?? "null");
      if (!cached || !Array.isArray(cached.tabs)) return;
      const snapshot = initialSession.current;
      const available = new Set([
        ...snapshot.initial.repositoryPaths,
        ...(snapshot.initial.uploads ?? []).map((file) => file.path),
        ...snapshot.initial.files.map((file) => file.path),
      ]);
      const restored = cached.tabs
        .filter((file: unknown): file is string => typeof file === "string" && available.has(file))
        .slice(0, 100);
      const selectedPath =
        snapshot.initialPath && available.has(snapshot.initialPath)
          ? snapshot.initialPath
          : available.has(cached.selected) || (cached.selected === "" && restored.length === 0)
            ? cached.selected
            : snapshot.firstPath;
      setTabs([...new Set([...restored, selectedPath])].filter(Boolean));
      setSelected(selectedPath);
      saved.current =
        snapshot.initial.files.find((file) => file.path === selectedPath)?.content ?? "";
      latest.current = saved.current;
      setText(saved.current);
    } catch {
      /* Browser storage is optional. Drafts remain on the server. */
    }
  }, [sessionKey]);
  useEffect(() => {
    try {
      sessionStorage.setItem(sessionKey, JSON.stringify({ tabs, selected }));
    } catch {
      /* Storage may be disabled by the browser. */
    }
  }, [sessionKey, tabs, selected]);

  useEffect(() => {
    if (
      !selected ||
      uploaded ||
      active ||
      branchStatuses[selected] === "delete" ||
      remoteFiles[selected] !== undefined
    )
      return;
    const controller = new AbortController();
    setBusy(true);
    void fetch(`${endpoint}?${new URLSearchParams({ branch, path: selected })}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        if (result.content !== null && typeof result.content !== "string")
          throw new Error("Не удалось прочитать файл");
        if (controller.signal.aborted) return;
        setRemoteFiles((current) => ({ ...current, [selected]: result.content }));
        saved.current = result.content ?? "";
        latest.current = saved.current;
        setText(saved.current);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(String(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [selected, active, uploaded, remoteFiles, endpoint, branch, branchStatuses]);

  const load = useCallback(
    async (guard = false) => {
      const response = await fetch(`${endpoint}?branch=${encodeURIComponent(branch)}`, {
        cache: "no-store",
      });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error);
      if (guard && (inFlight.current || latest.current !== saved.current)) return stateRef.current;
      stateRef.current = next;
      setState(next);
      return next as WorkbenchState;
    },
    [branch, endpoint],
  );

  const command = useCallback(
    async (payload: Record<string, unknown>) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch, ...payload }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      return result;
    },
    [branch, endpoint],
  );

  const save = useCallback(async (): Promise<boolean> => {
    if (latest.current === saved.current) return true;
    if (blocked.current || inFlight.current || readOnly || !selected) return false;
    inFlight.current = true;
    setBusy(true);
    const snapshot = latest.current;
    try {
      await command({
        action: "files",
        expectedRevision: stateRef.current.revision,
        files: [{ path: selected, content: snapshot }],
      });
      saved.current = snapshot;
      await load();
      setError("");
      return latest.current === snapshot;
    } catch (cause) {
      blocked.current = true;
      setNeedsMerge(true);
      setError(cause instanceof Error ? cause.message : "Ошибка сохранения");
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [command, load, readOnly, selected]);

  useEffect(() => {
    if (text === saved.current || !dirty || error || busy) return;
    const timer = setTimeout(() => void save(), 1200);
    return () => clearTimeout(timer);
  }, [dirty, text, error, busy, save]);

  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => {
      if (latest.current !== saved.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      if (inFlight.current || latest.current !== saved.current) return;
      void load(true)
        .then((next) => {
          const current = next.files.find((file) => file.path === selected);
          if (current && latest.current === saved.current) {
            saved.current = current.content;
            latest.current = current.content;
            setText(current.content);
          }
        })
        .catch(() => setNotice("Нет связи с сервером. Ваш текст остаётся в редакторе."));
    }, 15000);
    return () => clearInterval(timer);
  }, [load, selected]);

  useEffect(() => {
    const refresh = () => {
      if (!inFlight.current && latest.current === saved.current) {
        void load(true)
          .then((next) => {
            const file = next.files.find((item) => item.path === selected);
            if (file && !inFlight.current && latest.current === saved.current) {
              saved.current = file.content;
              latest.current = file.content;
              setText(file.content);
            }
          })
          .catch(() => setNotice("Нет связи с сервером."));
      } else setNotice("В ветке появились изменения. Ваш ввод остаётся в редакторе.");
    };
    window.addEventListener("pushdocs:refresh", refresh);
    return () => window.removeEventListener("pushdocs:refresh", refresh);
  }, [load, selected]);

  useEffect(() => {
    const navigate = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.button !== 0
      )
        return;
      const anchor = (event.target as Element).closest("a");
      if (
        !anchor ||
        anchor.closest(".workbench") ||
        anchor.target === "_blank" ||
        anchor.origin !== window.location.origin
      )
        return;
      event.preventDefault();
      const destination = new URL(anchor.href);
      if (destination.pathname.startsWith(`/projects/${projectId}/`))
        destination.searchParams.set("branch", branch);
      if (destination.pathname === `/projects/${projectId}/files`)
        destination.searchParams.set("document", selected);
      void save().then((ok) => {
        if (ok) router.push(destination.pathname + destination.search);
      });
    };
    document.addEventListener("click", navigate, true);
    return () => document.removeEventListener("click", navigate, true);
  }, [save, router, projectId, branch, selected]);

  useEffect(() => {
    const dismiss = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      for (const disclosure of document.querySelectorAll<HTMLDetailsElement>(
        ".workbench .wb-disclosure[open]",
      )) {
        if (event instanceof KeyboardEvent || !disclosure.contains(event.target as Node)) {
          disclosure.open = false;
          if (event instanceof KeyboardEvent) disclosure.querySelector("summary")?.focus();
        }
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, []);

  useEffect(() => {
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const elements = () => [
      ...(modal.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)",
      ) ?? []),
    ];
    if (dialog === "new" || dialog === "folder") {
      const input = modal.current?.querySelector<HTMLInputElement>('input[name="path"]');
      input?.focus();
      const value = input?.value ?? "";
      input?.setSelectionRange(value.lastIndexOf("/") + 1, value.length);
    } else elements()[0]?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !inFlight.current && !mediaBusyRef.current) setDialog(null);
      if (event.key === "Tab") {
        const items = elements();
        const first = items[0];
        const last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("keydown", handle);
      previous?.focus();
    };
  }, [dialog]);

  async function openFile(filePath: string) {
    if (!(await save())) return;
    const requestId = ++opening.current;
    const isUpload = stateRef.current.uploads?.some((item) => item.path === filePath);
    const file = stateRef.current.files.find(
      (item) => item.path === filePath && (!isUpload || item.status === "delete"),
    );
    let content =
      file?.content ??
      (isUpload ||
      branchStatuses[filePath] === "delete" ||
      (branchStatuses[filePath] && !stateRef.current.repositoryPaths.includes(filePath))
        ? null
        : remoteFiles[filePath]);
    if (!file && content === undefined) {
      setBusy(true);
      try {
        const response = await fetch(
          `${endpoint}?${new URLSearchParams({ branch, path: filePath })}`,
        );
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        if (result.content !== null && typeof result.content !== "string")
          throw new Error("Не удалось прочитать файл");
        content = result.content;
        setRemoteFiles((current) => ({ ...current, [filePath]: result.content }));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Не удалось открыть файл");
        return;
      } finally {
        if (opening.current === requestId) setBusy(false);
      }
    }
    if (opening.current !== requestId) return;
    if (!file && content === null) setRemoteFiles((current) => ({ ...current, [filePath]: null }));
    setMode("source");
    saved.current = content ?? "";
    latest.current = saved.current;
    setText(saved.current);
    setSelected(filePath);
    setTabs((current) => (current.includes(filePath) ? current : [...current, filePath]));
    window.history.replaceState(
      null,
      "",
      `?branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(filePath)}`,
    );
  }

  async function closeFile(filePath: string) {
    if (!(await save())) return;
    const remaining = tabs.filter((path) => path !== filePath);
    if (filePath === selected) {
      const next = remaining.at(-1);
      if (next) await openFile(next);
      else {
        saved.current = "";
        latest.current = "";
        setText("");
        setSelected("");
        window.history.replaceState(null, "", `?branch=${encodeURIComponent(branch)}`);
      }
    }
    setTabs(remaining);
  }

  async function mutate(payload: Record<string, unknown>, nextPath?: string) {
    if (!(await save())) return;
    setBusy(true);
    try {
      inFlight.current = true;
      await command({ ...payload, expectedRevision: stateRef.current.revision });
      await load();
      setDialog(null);
      setPlan(null);
      setError("");
      inFlight.current = false;
      if (nextPath) await openFile(nextPath);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Операция не выполнена");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function insert(value: string, wrap?: string) {
    const displayed = text.replace(/\r\n?/g, "\n");
    const start = textArea.current?.selectionStart ?? displayed.length;
    const end = textArea.current?.selectionEnd ?? start;
    const content = (
      wrap ? `${value}${displayed.slice(start, end) || "текст"}${wrap}` : value
    ).replace(/\r\n?/g, "\n");
    setText(applyEditorInput(text, displayed.slice(0, start) + content + displayed.slice(end)));
    requestAnimationFrame(() => {
      textArea.current?.focus();
      textArea.current?.setSelectionRange(start + content.length, start + content.length);
    });
  }

  async function submitDialog(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const path = String(data.get("path") ?? "");
    if (dialog === "branch") {
      if (!(await save())) return;
      setBusy(true);
      try {
        const result = await command({ action: "branch", name: path, sha: stateRef.current.sha });
        router.push(`?branch=${encodeURIComponent(result.name)}`);
        router.refresh();
        setDialog(null);
      } catch (cause) {
        setError(String(cause));
      } finally {
        setBusy(false);
      }
    } else if (dialog === "folder") {
      if (await mutate({ action: "folder", path })) setRevealDirectory(path);
    } else if (dialog === "new") {
      const title = String(data.get("title") ?? "").trim();
      await mutate(
        {
          action: "files",
          files: [
            {
              path,
              content:
                /\.mdx?$/i.test(path) && title
                  ? `---\ntitle: ${JSON.stringify(title)}\n---\n\n# ${title}\n`
                  : "",
              createOnly: true,
            },
          ],
        },
        path,
      );
    } else if (dialog === "move") {
      await mutate(
        {
          action: "files",
          files: [
            { path: selected, content: null },
            { path, content: latest.current, createOnly: true },
          ],
        },
        path,
      );
    } else if (dialog === "delete") {
      await mutate({ action: "files", files: [{ path: selected, content: null }] });
    } else if (dialog === "template") {
      try {
        const payload = {
          action: "template",
          templateId: String(data.get("template")),
          values: {
            title: String(data.get("title")),
            slug: String(data.get("slug")),
            locale: String(data.get("locale")),
          },
        };
        const result = await command({ ...payload, expectedRevision: stateRef.current.revision });
        setPlan(result.files);
        setTemplateInput({ ...payload, planDigest: result.planDigest });
      } catch (cause) {
        setError(String(cause));
      }
    }
  }

  return (
    <div className="workbench">
      <header className="wb-header">
        <div>
          <small>{projectName}</small>
          <h1>Документы</h1>
        </div>
        <div className="wb-actions">
          <details className="wb-disclosure wb-branch-picker">
            <summary>
              <GitBranch size={16} />
              <span>{branch}</span>
              <ChevronDown size={14} />
            </summary>
            <div className="wb-popover">
              <strong>Рабочая ветка</strong>
              <input
                className="wb-branch-search"
                aria-label="Поиск веток"
                placeholder="Найти ветку…"
                type="search"
                value={branchQuery}
                onChange={(event) => setBranchQuery(event.target.value)}
              />
              <select
                aria-label="Ветка"
                value={branch}
                onChange={async (event) => {
                  const value = event.target.value;
                  if (await save()) {
                    router.push(`?branch=${encodeURIComponent(value)}`);
                    router.refresh();
                  }
                }}
              >
                {state.branches
                  .filter(
                    (item) =>
                      item.full_ref === branch ||
                      item.full_ref.toLowerCase().includes(branchQuery.toLowerCase()),
                  )
                  .map((item) => (
                    <option key={item.full_ref} value={item.full_ref}>
                      {item.full_ref}
                      {item.is_protected ? " · защищена" : ""}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                disabled={projectReadOnly || busy}
                onClick={() => setDialog("branch")}
              >
                <GitBranch size={16} />
                Новая ветка
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  if (await save()) {
                    try {
                      await command({ action: "sync" });
                      setNotice("Получаем изменения из Git…");
                    } catch (cause) {
                      setError(String(cause));
                    }
                  }
                }}
              >
                <RefreshCw size={16} />
                Обновить
              </button>
            </div>
          </details>
          <Link
            href={`/projects/${projectId}/preview?branch=${encodeURIComponent(branch)}`}
            onClick={async (event) => {
              event.preventDefault();
              if (await save())
                router.push(`/projects/${projectId}/preview?branch=${encodeURIComponent(branch)}`);
            }}
          >
            <Eye size={16} />
            Открыть сайт
          </Link>
          <Link
            className="wb-primary"
            href={`/projects/${projectId}/changes?branch=${encodeURIComponent(branch)}`}
            onClick={async (event) => {
              event.preventDefault();
              if (await save())
                router.push(`/projects/${projectId}/changes?branch=${encodeURIComponent(branch)}`);
            }}
          >
            К изменениям <ArrowRight size={16} />
          </Link>
        </div>
      </header>
      {error ? (
        <div className="wb-alert" role="alert">
          {error}
          <button
            type="button"
            onClick={async () => {
              try {
                await load();
                setMode("diff");
                setNotice(
                  "Справа ваш текст, слева текущая сохранённая версия. Объедините правки вручную и подтвердите сохранение.",
                );
              } catch (cause) {
                setError(String(cause));
              }
            }}
          >
            Перечитать состояние
          </button>
        </div>
      ) : null}
      {needsMerge ? (
        <div className="wb-alert">
          <p>Автосохранение остановлено, ваш текст сохранён в этом окне.</p>
          <button
            type="button"
            onClick={() => {
              blocked.current = false;
              setNeedsMerge(false);
              setError("");
              void save();
            }}
          >
            Я объединил версии — сохранить
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="wb-notice" role="status">
          {notice}
          <button type="button" onClick={() => setNotice("")}>
            Закрыть
          </button>
        </div>
      ) : null}
      <div className="wb-layout">
        <aside className="wb-tree">
          <FileExplorer
            paths={explorerPaths}
            revealDirectory={revealDirectory}
            selected={selected}
            statuses={fileStatuses}
            statusError={statusError}
            readOnly={projectReadOnly}
            busy={busy}
            onOpen={(path) => void openFile(path)}
            onCreate={(kind, directory) => {
              setCreateDirectory(directory);
              setDialog(kind);
            }}
            onRefresh={() => void mutate({ action: "sync" })}
            onMedia={async () => {
              if (await save()) setDialog("media");
            }}
          />
          {state.config.templates.length ? (
            <button
              type="button"
              disabled={readOnly}
              onClick={() => {
                setPlan(null);
                setDialog("template");
              }}
            >
              Создать по шаблону
            </button>
          ) : null}
          <details className="wb-settings">
            <summary>
              <Settings2 size={15} /> Настройки файлов <ChevronDown size={14} />
            </summary>

            {state.role === "admin" ? (
              <button
                type="button"
                disabled={projectReadOnly || busy}
                onClick={async () => {
                  const path = ".pushdocs/config.json";
                  if (stateRef.current.files.some((file) => file.path === path))
                    await openFile(path);
                  else
                    await mutate(
                      {
                        action: "files",
                        files: [
                          {
                            path,
                            content: `${JSON.stringify(state.config, null, 2)}\n`,
                            createOnly: true,
                          },
                        ],
                      },
                      path,
                    );
                }}
              >
                {state.files.some((file) => file.path === ".pushdocs/config.json")
                  ? "Открыть конфигурацию проекта"
                  : "Создать конфигурацию проекта"}
              </button>
            ) : null}
          </details>
        </aside>
        <section className={`wb-editor${commentsOpen && selected ? " wb-editor--discussing" : ""}`}>
          <div className="wb-document">
            <div className="wb-tabs" role="tablist" aria-label="Открытые документы">
              {tabs.map((tab) => (
                <div
                  className="wb-tab-item"
                  key={tab}
                  data-active={tab === selected}
                  data-status={fileStatuses.get(tab)}
                  title={`${tab}${fileStatusLabel[fileStatuses.get(tab) ?? ""] ? ` · ${fileStatusLabel[fileStatuses.get(tab) ?? ""]}` : ""}`}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === selected}
                    onClick={() => void openFile(tab)}
                  >
                    <ExplorerFileIcon path={tab} /> {tab.split("/").at(-1)}
                  </button>
                  <button
                    type="button"
                    className="wb-tab-close"
                    aria-label={`Закрыть ${tab}`}
                    onClick={() => void closeFile(tab)}
                  >
                    <X size={13} aria-hidden />
                  </button>
                </div>
              ))}
            </div>
            {selected ? (
              <>
                <div className="wb-filebar">
                  <div className="wb-document-heading">
                    <code>{selected.split("/").join(" / ")}</code>
                  </div>
                  <div className="wb-save-info">
                    <span
                      aria-live="polite"
                      title="Черновик сохраняется в PushDocs. Для отправки в Git откройте «Изменения»."
                    >
                      {active && !busy && !dirty && !needsMerge ? <Check size={14} /> : null}
                      {!active
                        ? "Только чтение"
                        : needsMerge
                          ? "Автосохранение остановлено"
                          : busy
                            ? "Сохраняем…"
                            : dirty
                              ? "Есть изменения"
                              : "Черновик сохранён"}
                    </span>
                  </div>
                </div>
                <div className="wb-toolbar" hidden={!active}>
                  <div role="tablist" aria-label="Режим документа">
                    {(
                      [
                        ["source", "Файл"],
                        ["metadata", "Свойства"],
                        ["preview", "Просмотр"],
                        ["diff", "Изменения"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        type="button"
                        key={value}
                        aria-selected={mode === value}
                        role="tab"
                        onClick={() => setMode(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="wb-document-actions">
                    <button
                      type="button"
                      aria-expanded={commentsOpen}
                      aria-controls="wb-comment-panel"
                      onClick={() => setCommentsOpen(!commentsOpen)}
                    >
                      <MessageSquare size={16} /> Комментарии
                    </button>
                    <details className="wb-disclosure wb-document-menu">
                      <summary aria-label="Действия с документом" title="Действия с документом">
                        <MoreHorizontal size={18} />
                      </summary>
                      <div className="wb-popover">
                        <button
                          type="button"
                          disabled={readOnly || busy || !dirty}
                          onClick={() => void save()}
                        >
                          <Save size={16} /> Сохранить
                        </button>
                        <button type="button" disabled={readOnly} onClick={() => setDialog("move")}>
                          Перенести
                        </button>
                        <button
                          className="wb-danger"
                          type="button"
                          disabled={readOnly}
                          onClick={() => setDialog("delete")}
                          aria-label="Удалить документ"
                        >
                          <Trash2 size={15} /> Удалить документ
                        </button>
                      </div>
                    </details>
                  </div>
                </div>
                {mode === "source" && active && active.status !== "delete" ? (
                  <div className="wb-format" role="toolbar" aria-label="Форматирование документа">
                    <button
                      type="button"
                      title="Заголовок"
                      aria-label="Заголовок"
                      disabled={readOnly}
                      onClick={() => insert("\n## Заголовок\n")}
                    >
                      <Heading2 size={17} />
                    </button>
                    <button
                      type="button"
                      title="Жирный"
                      aria-label="Жирный"
                      disabled={readOnly}
                      onClick={() => insert("**", "**")}
                    >
                      <Bold size={17} />
                    </button>
                    <button
                      type="button"
                      title="Таблица"
                      aria-label="Таблица"
                      disabled={readOnly}
                      onClick={() =>
                        insert("\n| Колонка | Колонка |\n| --- | --- |\n| Значение | Значение |\n")
                      }
                    >
                      <Table2 size={17} />
                    </button>
                    <button
                      type="button"
                      disabled={readOnly}
                      onClick={() => insert("\n:::tip Важно\nТекст\n:::\n")}
                    >
                      Примечание
                    </button>
                    <span className="wb-format-separator" />
                    {components.length ? (
                      <details className="wb-disclosure">
                        <summary>
                          <Puzzle size={16} /> Компонент <ChevronDown size={12} />
                        </summary>
                        <div className="wb-popover">
                          <select
                            aria-label="Компонент MDX"
                            value={component}
                            onChange={(event) => setComponent(event.target.value)}
                          >
                            {components.map((item) => (
                              <option key={item.snippet} value={item.snippet}>
                                {item.label}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            disabled={readOnly}
                            onClick={(event) => {
                              insert(`\n${component}\n`);
                              event.currentTarget.closest("details")?.removeAttribute("open");
                            }}
                          >
                            Вставить компонент
                          </button>
                        </div>
                      </details>
                    ) : null}
                    <button
                      type="button"
                      disabled={readOnly || busy}
                      onClick={async () => {
                        if (await save()) setDialog("media");
                      }}
                    >
                      <Upload size={15} /> Вставить файл
                    </button>
                  </div>
                ) : null}
                <div className="wb-document-body">
                  {active?.status === "delete" ? (
                    <>
                      <div className="wb-notice">
                        Документ будет удалён при отправке.
                        <button
                          type="button"
                          onClick={() =>
                            void mutate(
                              { action: "files", files: [{ path: selected, revert: true }] },
                              selected,
                            )
                          }
                        >
                          Отменить удаление
                        </button>
                      </div>
                      {mode === "diff" && (
                        <DiffViewer key={selected} before={active.baseContent} after="" />
                      )}
                    </>
                  ) : !active && branchStatuses[selected] === "delete" ? (
                    <div className="wb-notice">Файл удалён в этой ветке.</div>
                  ) : !active && (uploaded || remoteFiles[selected] === null) ? (
                    <div className="wb-binary-preview">
                      {/\.(png|jpe?g|gif|webp|avif)$/i.test(selected) ? (
                        // biome-ignore lint/performance/noImgElement: Authenticated repository images must use the user's session directly.
                        <img
                          alt={selected.split("/").at(-1)}
                          src={`/api/projects/${projectId}/assets?${new URLSearchParams({ branch, path: selected, revision: String(state.revision) })}`}
                        />
                      ) : (
                        <ExplorerFileIcon path={selected} />
                      )}
                      <a
                        href={
                          state.repositoryPaths.includes(selected) && !uploaded
                            ? `${endpoint}?${new URLSearchParams({ branch, path: selected, download: "1" })}`
                            : `/api/projects/${projectId}/assets?${new URLSearchParams({ branch, path: selected })}`
                        }
                        download
                      >
                        Скачать файл
                      </a>
                    </div>
                  ) : mode === "source" ? (
                    <SourceEditor
                      inputRef={textArea}
                      value={text}
                      readOnly={readOnly}
                      onChange={setText}
                      onSave={() => {
                        void save();
                      }}
                      onIndent={() => insert("  ")}
                    />
                  ) : mode === "metadata" ? (
                    <MetadataEditor
                      value={text}
                      fields={state.config.metadata}
                      path={selected}
                      readOnly={readOnly || !/\.mdx?$/i.test(selected)}
                      onChange={setText}
                    />
                  ) : mode === "preview" ? (
                    <DocumentPreview
                      source={text}
                      projectId={projectId}
                      branch={branch}
                      path={selected}
                      repositoryPaths={state.repositoryPaths}
                      locale={active?.locale ?? state.config.defaultLocale}
                      media={state.config.media}
                    />
                  ) : (
                    <DiffViewer
                      key={selected}
                      before={
                        (needsMerge ? active?.content : active?.baseContent) ??
                        remoteFiles[selected] ??
                        ""
                      }
                      after={text}
                      beforeLabel={needsMerge ? "Текущая версия PushDocs" : "Исходный файл"}
                    />
                  )}
                </div>
                <details className="wb-replace">
                  <summary>Найти и заменить в документе</summary>
                  <div>
                    <input
                      aria-label="Найти текст"
                      value={replace}
                      onChange={(event) => setReplace(event.target.value)}
                    />
                    <input
                      aria-label="Заменить на"
                      value={replacement}
                      onChange={(event) => setReplacement(event.target.value)}
                    />
                    <button
                      type="button"
                      disabled={readOnly || !replace}
                      onClick={() => {
                        setText(text.split(replace).join(replacement));
                        setMode("diff");
                      }}
                    >
                      Заменить и показать изменения
                    </button>
                  </div>
                </details>
              </>
            ) : (
              <div className="wb-empty">
                <h2>Выберите или создайте документ</h2>
              </div>
            )}
          </div>
          {selected ? (
            <aside
              id="wb-comment-panel"
              className="wb-comment-panel"
              aria-label="Обсуждение документа"
              hidden={!commentsOpen}
            >
              <button
                className="wb-comment-close"
                type="button"
                aria-label="Закрыть комментарии"
                onClick={() => setCommentsOpen(false)}
              >
                <X size={16} />
              </button>
              <FileComments key={selected} projectId={projectId} branch={branch} path={selected} />
            </aside>
          ) : null}
        </section>
      </div>
      {dialog ? (
        <div className="wb-modal-backdrop">
          <section
            className={`wb-modal${dialog === "media" ? " wb-media-modal" : ""}`}
            ref={modal}
            role="dialog"
            aria-modal="true"
            aria-label="Операция с проектом"
          >
            <header>
              <h2>
                {
                  {
                    new: "Новый файл",
                    folder: "Новая папка",
                    branch: "Новая ветка",
                    move: "Перенести документ",
                    delete: "Удалить документ",
                    media: "Вложения",
                    template: "Создать по шаблону",
                  }[dialog]
                }
              </h2>
              <button type="button" disabled={mediaBusy} onClick={() => setDialog(null)}>
                Закрыть
              </button>
            </header>
            {dialog === "media" ? (
              <MediaLibrary
                projectId={projectId}
                branch={branch}
                document={article}
                onBusyChange={setMediaBusy}
                onChanged={async (path) => {
                  await load();
                  if (path) setRevealDirectory(path.slice(0, path.lastIndexOf("/")));
                }}
                onInsert={
                  !readOnly && /\.mdx?$/i.test(selected)
                    ? (url) => {
                        void load()
                          .then(() => {
                            const name = decodeURIComponent(
                              url.split("/").at(-1) ?? "Файл",
                            ).replace(/[[\]]/g, "");
                            insert(
                              `\n${/\.(png|jpe?g|gif|webp|avif|svg)$/i.test(url) ? "!" : ""}[${name}](${url})\n`,
                            );
                            setMode("source");
                            setDialog(null);
                          })
                          .catch((cause) => setError(String(cause)));
                      }
                    : undefined
                }
              />
            ) : (
              <form onSubmit={submitDialog}>
                {dialog === "template" ? (
                  <label>
                    Заголовок
                    <input name="title" required={dialog === "template"} />
                  </label>
                ) : null}
                {dialog === "new" ||
                dialog === "folder" ||
                dialog === "branch" ||
                dialog === "move" ? (
                  <label>
                    {dialog === "branch"
                      ? "Имя ветки"
                      : dialog === "folder"
                        ? "Путь папки"
                        : "Путь файла"}
                    <input
                      name="path"
                      required
                      defaultValue={
                        dialog === "new" || dialog === "folder"
                          ? `${createDirectory ? `${createDirectory}/` : ""}${dialog === "new" ? "new-file.mdx" : "new-folder"}`
                          : dialog === "move"
                            ? selected
                            : "docs/"
                      }
                    />
                  </label>
                ) : null}
                {dialog === "folder" ? (
                  <small>Пустая папка сохраняется с файлом .gitkeep.</small>
                ) : null}
                {dialog === "delete" ? (
                  <p>
                    Файл {selected} будет помечен для удаления. До отправки в Git удаление можно
                    отменить.
                  </p>
                ) : null}
                {dialog === "branch" ? (
                  <p>
                    Основа: {branch}, {state.sha.slice(0, 8)}. Черновики остаются в исходной ветке.
                  </p>
                ) : null}
                {dialog === "move" ? (
                  <p>
                    Перенос добавит новый путь и удалит прежний одним коммитом. Проверьте ссылки на
                    старый путь через поиск.
                  </p>
                ) : null}
                {dialog === "template" ? (
                  <>
                    <label>
                      Шаблон
                      <select name="template">
                        {state.config.templates.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Имя в URL
                      <input name="slug" required />
                    </label>
                  </>
                ) : null}
                {dialog === "template" ? (
                  <label>
                    Язык
                    <input name="locale" defaultValue={state.config.defaultLocale} required />
                  </label>
                ) : null}
                <button className="wb-primary" type="submit" disabled={busy}>
                  {busy
                    ? "Выполняем…"
                    : dialog === "template"
                      ? "Показать план файлов"
                      : dialog === "new"
                        ? "Создать файл"
                        : dialog === "folder"
                          ? "Создать папку"
                          : "Применить"}
                </button>
              </form>
            )}
            {plan ? (
              <div className="wb-plan">
                <h3>План изменений файлов</h3>
                {plan.map((file) => (
                  <details key={file.path}>
                    <summary>{file.path}</summary>
                    <pre>{file.content}</pre>
                  </details>
                ))}
                <button
                  type="button"
                  className="wb-primary"
                  disabled={busy}
                  onClick={() => void mutate({ ...templateInput, apply: true }, plan[0]?.path)}
                >
                  Применить весь план
                </button>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
