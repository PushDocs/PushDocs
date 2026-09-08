"use client";

import { applyEditorInput } from "@pushdocs/content/editing";
import type { ProjectConfig } from "@pushdocs/contracts";
import {
  ArrowRight,
  Eye,
  FilePlus2,
  FileText,
  Folder,
  GitBranch,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileComments } from "./file-comments";
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
  revision: number;
  status: string;
  sha: string;
  repositoryPaths: string[];
  config: ProjectConfig;
  branches: Array<{ full_ref: string; is_protected?: boolean }>;
  role: string;
  changeSetId?: string;
}
type Dialog = "new" | "branch" | "move" | "delete" | "upload" | "template" | "media" | null;

export function Workbench({
  projectId,
  projectName,
  branch,
  initial,
  initialPath,
  components = [],
}: {
  projectId: string;
  projectName: string;
  branch: string;
  initial: WorkbenchState;
  initialPath?: string;
  components?: Array<{ label: string; snippet: string }>;
}) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const stateRef = useRef(initial);
  const firstPath =
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
  const [query, setQuery] = useState("");
  const [branchQuery, setBranchQuery] = useState("");
  const [locale, setLocale] = useState("all");
  const [version, setVersion] = useState("all");
  const [fileStatus, setFileStatus] = useState("all");
  const [technical, setTechnical] = useState(Boolean(initialPath && !/\.mdx?$/.test(initialPath)));
  const [mode, setMode] = useState<"source" | "preview" | "diff" | "metadata">("source");
  const [dialog, setDialog] = useState<Dialog>(null);
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
  const readOnly = state.role === "reader" || state.status !== "open";
  const active = state.files.find((file) => file.path === selected);
  const dirty = text !== saved.current;
  latest.current = text;

  useEffect(() => {
    try {
      const cached = JSON.parse(sessionStorage.getItem(sessionKey) ?? "null");
      if (!cached || !Array.isArray(cached.tabs)) return;
      const snapshot = initialSession.current;
      const available = new Set(snapshot.initial.files.map((file) => file.path));
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
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const elements = () => [
      ...(modal.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)",
      ) ?? []),
    ];
    elements()[0]?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !inFlight.current) setDialog(null);
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
    const file = stateRef.current.files.find((item) => item.path === filePath);
    saved.current = file?.content ?? "";
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
    } else if (dialog === "new") {
      await mutate(
        {
          action: "files",
          files: [
            {
              path,
              content: `---\ntitle: ${JSON.stringify(String(data.get("title")))}\n---\n\n# ${data.get("title")}\n`,
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
    } else if (dialog === "upload") {
      if (!(await save())) return;
      setBusy(true);
      inFlight.current = true;
      const links: string[] = [];
      try {
        for (const file of data.getAll("files")) {
          if (!(file instanceof File) || !file.size) continue;
          const query = new URLSearchParams({
            branch,
            name: file.name,
            document: selected,
            locale: String(data.get("locale")),
            revision: String(stateRef.current.revision),
            replace: String(data.get("replace") === "on"),
          });
          if (path) query.set("path", `${path.replace(/\/$/, "")}/${file.name}`);
          const response = await fetch(`/api/projects/${projectId}/assets?${query}`, {
            method: "POST",
            headers: { "Content-Type": file.type || "application/octet-stream" },
            body: file,
          });
          const result = await response.json();
          if (!response.ok) throw new Error(`${file.name}: ${result.error}`);
          links.push(
            `${file.type.startsWith("image/") ? "!" : ""}[${file.name.replace(/[[\]]/g, "")}](${result.url})`,
          );
          await load();
        }
        setNotice(`Загружено файлов: ${links.length}. Ссылки вставлены в документ.`);
        setDialog(null);
      } catch (cause) {
        setError(String(cause));
      } finally {
        if (selected && links.length) insert(`\n${links.join("\n\n")}\n`);
        inFlight.current = false;
        setBusy(false);
      }
    }
  }

  const visible = state.files.filter(
    (file) =>
      (technical || (/\.mdx?$/.test(file.path) && !/<Redirect\b/.test(file.content))) &&
      (locale === "all" || file.locale === locale) &&
      (version === "all" || file.version === version) &&
      (fileStatus === "all" ||
        (fileStatus === "changed" ? file.status !== "clean" : file.status === fileStatus)) &&
      `${file.path}\n${file.title}\n${file.content}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );
  const groups = new Map<string, WorkingFile[]>();
  for (const file of visible) {
    const dir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : ".";
    groups.set(dir, [...(groups.get(dir) ?? []), file]);
  }

  return (
    <div className="workbench">
      <header className="wb-header">
        <div>
          <small>{projectName}</small>
          <h1>Документы</h1>
        </div>
        <div className="wb-actions">
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
          <button type="button" disabled={readOnly || busy} onClick={() => setDialog("branch")}>
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
          <label className="wb-search">
            <Search size={16} />
            <input
              aria-label="Поиск по документам и тексту"
              placeholder="Найти в документах…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="wb-tree-tools">
            <select
              aria-label="Язык документов"
              value={locale}
              onChange={(event) => setLocale(event.target.value)}
            >
              <option value="all">Все языки</option>
              {[...new Set(state.files.map((file) => file.locale))].map((value) => (
                <option key={value} value={value}>
                  {value === "default"
                    ? state.config.defaultLocale.toUpperCase()
                    : value.toUpperCase()}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label="Создать документ"
              disabled={readOnly}
              onClick={() => setDialog("new")}
            >
              <FilePlus2 size={17} />
            </button>
          </div>
          <div className="wb-tree-tools">
            <select
              aria-label="Версия документов"
              value={version}
              onChange={(event) => setVersion(event.target.value)}
            >
              <option value="all">Все версии</option>
              {[...new Set(state.files.map((file) => file.version))].map((value) => (
                <option key={value} value={value}>
                  {value === "current" ? "Текущая" : value}
                </option>
              ))}
            </select>
            <select
              aria-label="Статус документов"
              value={fileStatus}
              onChange={(event) => setFileStatus(event.target.value)}
            >
              <option value="all">Все статусы</option>
              <option value="changed">Есть изменения</option>
              <option value="add">Новые</option>
              <option value="modify">Изменены</option>
              <option value="delete">Удалены</option>
            </select>
          </div>
          <label className="wb-checkbox">
            <input
              type="checkbox"
              checked={technical}
              onChange={(event) => setTechnical(event.target.checked)}
            />
            Служебные файлы
          </label>
          <nav aria-label="Дерево документов">
            {[...groups].map(([dir, files]) => (
              <details open key={dir}>
                <summary>
                  <Folder size={14} />
                  <span>{dir}</span>
                  <small>{files.length}</small>
                </summary>
                {files.map((file) => (
                  <button
                    type="button"
                    className={file.path === selected ? "active" : ""}
                    key={file.path}
                    onClick={() => void openFile(file.path)}
                  >
                    <FileText size={14} />
                    <span>
                      {file.title}
                      <small>{file.path.split("/").at(-1)}</small>
                    </span>
                    {file.status !== "clean" ? (
                      <i>{file.status === "delete" ? "D" : file.status === "add" ? "A" : "M"}</i>
                    ) : null}
                  </button>
                ))}
              </details>
            ))}
          </nav>
          {state.role === "admin" ? (
            <button
              type="button"
              disabled={readOnly || busy}
              onClick={async () => {
                const path = ".pushdocs/config.json";
                setTechnical(true);
                if (stateRef.current.files.some((file) => file.path === path)) await openFile(path);
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
              Конфигурация проекта
            </button>
          ) : null}
          {!visible.length ? (
            <p className="wb-empty">Документы не найдены. Проверьте фильтры или обновите ветку.</p>
          ) : null}
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
        </aside>
        <section className="wb-editor">
          <div className="wb-tabs" role="tablist" aria-label="Открытые документы">
            {tabs.map((tab) => (
              <div className="wb-tab-item" key={tab}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === selected}
                  onClick={() => void openFile(tab)}
                >
                  {tab.split("/").at(-1)}
                </button>
                <button
                  type="button"
                  className="wb-tab-close"
                  aria-label={`Закрыть ${tab}`}
                  onClick={() => void closeFile(tab)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          {selected ? (
            <>
              <div className="wb-filebar">
                <code>{selected}</code>
                <span aria-live="polite">
                  {busy ? "Сохраняем…" : dirty ? "Есть изменения" : "Сохранено в PushDocs"}
                </span>
              </div>
              <div className="wb-toolbar">
                <div role="tablist" aria-label="Режим документа">
                  {(
                    [
                      ["source", "MDX"],
                      ["metadata", "Метаданные"],
                      ["preview", "Быстрый просмотр"],
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
                <button
                  type="button"
                  disabled={readOnly || busy || !dirty}
                  onClick={() => void save()}
                >
                  <Save size={16} />
                  Сохранить
                </button>
              </div>
              <div className="wb-format">
                {components.length ? (
                  <>
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
                      onClick={() => insert(`\n${component}\n`)}
                    >
                      Вставить компонент
                    </button>
                  </>
                ) : null}
                <button type="button" disabled={readOnly} onClick={() => insert("**", "**")}>
                  Жирный
                </button>
                <button
                  type="button"
                  disabled={readOnly}
                  onClick={() => insert("\n## Заголовок\n")}
                >
                  Заголовок
                </button>
                <button
                  type="button"
                  disabled={readOnly}
                  onClick={() =>
                    insert("\n| Колонка | Колонка |\n| --- | --- |\n| Значение | Значение |\n")
                  }
                >
                  Таблица
                </button>
                <button
                  type="button"
                  disabled={readOnly}
                  onClick={() => insert("\n:::tip Важно\nТекст\n:::\n")}
                >
                  Примечание
                </button>
                <button type="button" disabled={readOnly} onClick={() => setDialog("upload")}>
                  <Upload size={15} />
                  Файлы
                </button>
                <button
                  type="button"
                  disabled={readOnly || busy}
                  onClick={async () => {
                    if (await save()) setDialog("media");
                  }}
                >
                  Медиатека
                </button>
                <button type="button" disabled={readOnly} onClick={() => setDialog("move")}>
                  Перенести
                </button>
                <button
                  type="button"
                  disabled={readOnly}
                  onClick={() => setDialog("delete")}
                  aria-label="Удалить документ"
                >
                  <Trash2 size={15} />
                </button>
              </div>
              {active?.status === "delete" ? (
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
                  readOnly={readOnly || !/\.mdx?$/i.test(selected)}
                  onChange={setText}
                />
              ) : mode === "preview" ? (
                <article className="wb-markdown">
                  <p className="wb-hint">
                    Компоненты и оформление Docusaurus проверяйте через «Открыть сайт».
                  </p>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")}
                  </ReactMarkdown>
                </article>
              ) : (
                <div className="wb-diff">
                  <section>
                    <h3>{needsMerge ? "Текущая версия PushDocs" : "Исходный файл"}</h3>
                    <pre>
                      {(needsMerge ? active?.content : active?.baseContent) || "Новый файл"}
                    </pre>
                  </section>
                  <section>
                    <h3>Ваши изменения</h3>
                    <pre>{text}</pre>
                  </section>
                </div>
              )}
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
              <FileComments key={selected} projectId={projectId} branch={branch} path={selected} />
            </>
          ) : (
            <div className="wb-empty">
              <h2>Выберите или создайте документ</h2>
              <p>Если ветка только создана, нажмите «Обновить» и дождитесь импорта.</p>
            </div>
          )}
        </section>
      </div>
      {dialog ? (
        <div className="wb-modal-backdrop">
          <section
            className="wb-modal"
            ref={modal}
            role="dialog"
            aria-modal="true"
            aria-label="Операция с проектом"
          >
            <header>
              <h2>
                {
                  {
                    new: "Новый документ",
                    branch: "Новая ветка",
                    move: "Перенести документ",
                    delete: "Удалить документ",
                    upload: "Загрузить файлы",
                    media: "Медиатека",
                    template: "Создать по шаблону",
                  }[dialog]
                }
              </h2>
              <button type="button" onClick={() => setDialog(null)}>
                Закрыть
              </button>
            </header>
            {dialog === "media" ? (
              <MediaLibrary
                projectId={projectId}
                branch={branch}
                document={selected}
                onInsert={(url) => {
                  void load()
                    .then(() => {
                      const name = decodeURIComponent(url.split("/").at(-1) ?? "Файл").replace(
                        /[[\]]/g,
                        "",
                      );
                      insert(
                        `\n${/\.(png|jpe?g|gif|webp|avif|svg)$/i.test(url) ? "!" : ""}[${name}](${url})\n`,
                      );
                      setDialog(null);
                    })
                    .catch((cause) => setError(String(cause)));
                }}
              />
            ) : (
              <form onSubmit={submitDialog}>
                {dialog === "new" || dialog === "template" ? (
                  <label>
                    Заголовок
                    <input name="title" required />
                  </label>
                ) : null}
                {dialog === "new" || dialog === "branch" || dialog === "move" ? (
                  <label>
                    {dialog === "branch" ? "Имя ветки" : "Путь файла"}
                    <input
                      name="path"
                      required
                      defaultValue={
                        dialog === "new"
                          ? "docs/new-article.mdx"
                          : dialog === "move"
                            ? selected
                            : "docs/"
                      }
                    />
                  </label>
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
                {dialog === "upload" ? (
                  <>
                    <label>
                      Файлы
                      <input name="files" type="file" multiple required />
                    </label>
                    <label>
                      Каталог назначения
                      <input name="path" placeholder="Автоматически по настройкам проекта" />
                    </label>
                    <label className="wb-checkbox">
                      <input name="replace" type="checkbox" />
                      Заменить существующие файлы с такими же путями
                    </label>
                  </>
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
                {dialog === "template" || dialog === "upload" ? (
                  <label>
                    Язык
                    <input
                      name="locale"
                      defaultValue={
                        locale === "all" || locale === "default"
                          ? state.config.defaultLocale
                          : locale
                      }
                      required
                    />
                  </label>
                ) : null}
                <button className="wb-primary" type="submit" disabled={busy}>
                  {busy
                    ? "Выполняем…"
                    : dialog === "template"
                      ? "Показать план файлов"
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
