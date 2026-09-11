"use client";

import { assetLocation } from "@pushdocs/content/config";
import { applyEditorInput } from "@pushdocs/content/editing";
import type { ProjectConfig } from "@pushdocs/contracts";
import { Select } from "@pushdocs/ui";
import {
  ArrowRight,
  Bold,
  Check,
  ChevronDown,
  Columns2,
  GitBranch,
  Heading2,
  MessageSquare,
  MoreHorizontal,
  Puzzle,
  RefreshCw,
  Save,
  Search,
  Table2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { gitOperationStatusAction, startGitOperationAction } from "@/app/actions";
import { DiffViewer } from "./diff-viewer";
import { DocumentPreview } from "./document-preview";
import { DocumentTabs } from "./document-tabs";
import {
  clearDraft,
  draftKey,
  type LocalDraft,
  readDraft,
  WorkbenchRequestError,
  writeDraft,
} from "./draft-storage";
import { uploadExplorerFiles } from "./explorer-upload";
import { FileComments } from "./file-comments";
import { ExplorerFileIcon, FileExplorer } from "./file-explorer";
import { mergeFileStatuses } from "./file-status";
import { MediaLibrary } from "./media-library";
import { MetadataEditor } from "./metadata-editor";
import { rememberProjectBranch } from "./project-context";
import { QuickOpen } from "./quick-open";
import { planReplacement, ReplacePreview } from "./replace-preview";
import { SourceEditor, type SourceEditorHandle } from "./source-editor";

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
  ownerId?: string;
  revision: number;
  status: string;
  sha: string;
  repositoryPaths: string[];
  config: ProjectConfig;
  branches: Array<{ full_ref: string; is_protected?: boolean }>;
  role: string;
  changeSetId?: string;
}
type Dialog =
  | "replace"
  | "search"
  | "folder"
  | "new"
  | "branch"
  | "rename"
  | "move"
  | "delete"
  | "template"
  | "media"
  | null;

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
  const recoveryBase = useRef<string | undefined>(undefined);
  const latest = useRef(text);
  const textArea = useRef<SourceEditorHandle>(null);
  const modal = useRef<HTMLElement>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [branchQuery, setBranchQuery] = useState("");
  const [createDirectory, setCreateDirectory] = useState("");
  const [revealDirectory, setRevealDirectory] = useState("");
  const [branchStatuses, setBranchStatuses] = useState<Record<string, string>>({});
  const [statusError, setStatusError] = useState("");
  const [remoteFiles, setRemoteFiles] = useState<Record<string, string | null>>({});
  const opening = useRef(0);
  const [mode, setMode] = useState<"source" | "preview" | "diff" | "metadata" | "split">("source");
  const [dialog, setDialog] = useState<Dialog>(initialPanel ?? null);
  const [replaceAttachment, setReplaceAttachment] = useState<string>();
  const [mediaBusy, setMediaBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const mediaBusyRef = useRef(false);
  mediaBusyRef.current = mediaBusy;
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveFailure, setSaveFailure] = useState<"network" | "permission" | "other" | null>(null);
  const [recovery, setRecovery] = useState<LocalDraft>();
  const [searchContent, setSearchContent] = useState(false);
  const [jump, setJump] = useState<{ line: number; token: number }>();
  const [closedTabs, setClosedTabs] = useState<string[]>([]);
  const [explorerWidth, setExplorerWidth] = useState(280);
  const draftId = draftKey(projectId, branch, selected, state.ownerId);
  useEffect(() => {
    rememberProjectBranch(projectId, branch);
  }, [projectId, branch]);
  useEffect(() => {
    recoveryBase.current = undefined;
    const draft = readDraft(draftId);
    setRecovery(draft && draft.text !== saved.current ? draft : undefined);
  }, [draftId]);
  useEffect(() => {
    try {
      const width = Number(localStorage.getItem("pushdocs:explorer-width"));
      if (width >= 200 && width <= 600) setExplorerWidth(width);
    } catch {}
  }, []);
  function editText(value: string) {
    if (!writeDraft(draftId, value, recoveryBase.current ?? saved.current))
      setNotice(
        "Не удалось сохранить резервную копию в браузере. Не закрывайте вкладку до сохранения на сервере.",
      );
    setText(value);
  }
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
  const readOnly = projectReadOnly || !active || !!recovery || saveFailure === "permission";
  const isArticle = !!active && /\.mdx?$/i.test(selected);
  const readOnlyReason =
    state.role === "reader"
      ? "У вас роль читателя. Для редактирования нужна роль редактора."
      : state.status !== "open"
        ? "Редактирование станет доступно после завершения отправки или разрешения конфликтов."
        : saveFailure === "permission"
          ? "Нет прав на сохранение. Обратитесь к администратору проекта."
          : !active && !uploaded && remoteFiles[selected] !== null
            ? "Этот файл доступен только для чтения по настройкам проекта."
            : "";
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
  const mediaLocation = useMemo(() => {
    try {
      const locale = state.files.find((file) => file.path === article)?.locale;
      return assetLocation(
        state.config,
        !locale || locale === "default" ? state.config.defaultLocale : locale,
        article,
        "placeholder",
      );
    } catch {
      return undefined;
    }
  }, [state.config, state.files, article]);
  const mediaDirectory = mediaLocation?.path.slice(0, mediaLocation.path.lastIndexOf("/") + 1);
  const attachmentUrl =
    mediaLocation && mediaDirectory && selected.startsWith(mediaDirectory)
      ? mediaLocation.url.slice(0, mediaLocation.url.lastIndexOf("/") + 1) +
        selected.slice(mediaDirectory.length).split("/").map(encodeURIComponent).join("/")
      : undefined;
  const replacementPlan = useMemo(
    () => planReplacement(text, replace, replacement),
    [text, replace, replacement],
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
      window.dispatchEvent(new Event("pushdocs:context"));
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
      if (!response.ok) throw new WorkbenchRequestError(result.error, response.status);
      return result;
    },
    [branch, endpoint],
  );

  const save = useCallback(async (): Promise<boolean> => {
    if (latest.current === saved.current) return true;
    if (blocked.current || inFlight.current || readOnly || !selected) return false;
    inFlight.current = true;
    setBusy(true);
    setSaving(true);
    const snapshot = latest.current;
    try {
      await command({
        action: "files",
        expectedRevision: stateRef.current.revision,
        files: [{ path: selected, content: snapshot }],
      });
      saved.current = snapshot;
      await load();
      recoveryBase.current = undefined;
      if (latest.current === snapshot) clearDraft(draftId);
      else writeDraft(draftId, latest.current, snapshot);
      setError("");
      setSaveFailure(null);
      return latest.current === snapshot;
    } catch (cause) {
      const status = cause instanceof WorkbenchRequestError ? cause.status : 0;
      if (status === 409) {
        blocked.current = true;
        setNeedsMerge(true);
      } else
        setSaveFailure(
          status === 401 || status === 403
            ? "permission"
            : status === 0 || status >= 500
              ? "network"
              : "other",
        );
      setError(
        status === 0 || status >= 500
          ? "Нет связи с сервером. Ваш текст остаётся в редакторе."
          : cause instanceof Error
            ? cause.message
            : "Ошибка сохранения",
      );
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
      setSaving(false);
    }
  }, [command, load, readOnly, selected, draftId]);

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
    const handle = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        (event.key.toLowerCase() === "p" || (event.shiftKey && event.key.toLowerCase() === "f"))
      ) {
        event.preventDefault();
        if (dialog && dialog !== "search") return;
        setSearchContent(event.key.toLowerCase() === "f");
        setDialog("search");
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [dialog]);
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
    if (dialog === "search") {
      modal.current?.querySelector<HTMLInputElement>('input[aria-label="Поиск файлов"]')?.focus();
    } else if (
      dialog === "new" ||
      dialog === "folder" ||
      dialog === "rename" ||
      dialog === "move"
    ) {
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
    if (!(await save())) return false;
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
    setJump(undefined);
    setSaveFailure(null);
    setError("");
    setTabs((current) => (current.includes(filePath) ? current : [...current, filePath]));
    window.history.replaceState(
      null,
      "",
      `?branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(filePath)}`,
    );
    return true;
  }

  async function closeFile(filePath: string) {
    if (!(await save())) return;
    setClosedTabs((current) =>
      [...current.filter((path) => path !== filePath), filePath].slice(-20),
    );
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

  const receiveGeneration = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Cancel pending polling when the working context changes.
  useEffect(
    () => () => {
      receiveGeneration.current += 1;
    },
    [projectId, branch],
  );
  async function receiveChanges() {
    const generation = receiveGeneration.current;
    if (busy || !(await save())) return;
    setBusy(true);
    setError("");
    setNotice("Получаем изменения из Git…");
    try {
      const jobId = await startGitOperationAction({ projectId, branch });
      const deadline = Date.now() + 300_000;
      while (Date.now() < deadline && generation === receiveGeneration.current) {
        const job = await gitOperationStatusAction(projectId, jobId);
        if (generation !== receiveGeneration.current) return;
        if (job.status === "failed")
          throw new Error("Не удалось получить изменения из Git. Повторите попытку.");
        if (job.status === "done") {
          await load(true);
          setNotice("Изменения получены из Git");
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      if (generation === receiveGeneration.current)
        throw new Error("Получение ещё выполняется. Обновите состояние позже.");
    } catch (cause) {
      if (generation === receiveGeneration.current) {
        setNotice("");
        setError(cause instanceof Error ? cause.message : "Нет связи с сервером");
      }
    } finally {
      if (generation === receiveGeneration.current) setBusy(false);
    }
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
    if (textArea.current?.replaceSelection) {
      textArea.current.replaceSelection(value, wrap);
      return;
    }
    const displayed = text.replace(/\r\n?/g, "\n");
    const start = textArea.current?.selectionStart ?? displayed.length;
    const end = textArea.current?.selectionEnd ?? start;
    const content = (
      wrap ? `${value}${displayed.slice(start, end) || "текст"}${wrap}` : value
    ).replace(/\r\n?/g, "\n");
    editText(applyEditorInput(text, displayed.slice(0, start) + content + displayed.slice(end)));
    requestAnimationFrame(() => {
      textArea.current?.focus();
      textArea.current?.setSelectionRange(start + content.length, start + content.length);
    });
  }

  async function submitDialog(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const inputPath = String(data.get("path") ?? "");
    const path =
      dialog === "rename" ? [...selected.split("/").slice(0, -1), inputPath].join("/") : inputPath;
    if (dialog === "rename" && /[/\\]/.test(inputPath)) {
      setError("Введите имя файла без пути к папке.");
      return;
    }
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
    } else if (dialog === "move" || dialog === "rename") {
      if (path === selected) {
        setDialog(null);
        return;
      }
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
    <div
      className="workbench"
      style={{ "--explorer-width": `${explorerWidth}px` } as React.CSSProperties}
    >
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
              <Select
                label="Ветка"
                options={state.branches
                  .filter(
                    (item) =>
                      item.full_ref === branch ||
                      item.full_ref.toLowerCase().includes(branchQuery.toLowerCase()),
                  )
                  .map((item) => ({
                    label: `${item.full_ref}${item.is_protected ? " · защищена" : ""}`,
                    value: item.full_ref,
                  }))}
                value={branch}
                onValueChange={async (value) => {
                  if (await save()) {
                    router.push(`?branch=${encodeURIComponent(value)}`);
                    router.refresh();
                  }
                }}
              />
              <button
                type="button"
                disabled={projectReadOnly || busy}
                onClick={() => setDialog("branch")}
              >
                <GitBranch size={16} />
                Новая ветка
              </button>
              <button type="button" disabled={busy} onClick={() => void receiveChanges()}>
                <RefreshCw size={16} />
                Получить из Git
              </button>
            </div>
          </details>
          <Link
            className="wb-primary"
            href={`/projects/${projectId}/changes?branch=${encodeURIComponent(branch)}`}
            onClick={async (event) => {
              event.preventDefault();
              if (await save())
                router.push(`/projects/${projectId}/changes?branch=${encodeURIComponent(branch)}`);
            }}
          >
            К изменениям (
            {
              new Set([
                ...state.files.filter((file) => file.status !== "clean").map((file) => file.path),
                ...(state.uploads ?? []).map((file) => file.path),
              ]).size
            }
            ) <ArrowRight size={16} />
          </Link>
        </div>
      </header>
      {error ? (
        <div className="wb-alert" role="alert">
          {error}
          {saveFailure !== "permission" ? (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                try {
                  const next = await load();
                  if (needsMerge) {
                    setMode("diff");
                    setNotice("Сравните сохранённую версию и ваш текст, затем сохраните итог.");
                    return;
                  }
                  const current = next.files.find((file) => file.path === selected);
                  if (
                    saveFailure &&
                    current &&
                    current.content !== saved.current &&
                    current.content !== latest.current
                  ) {
                    blocked.current = true;
                    setNeedsMerge(true);
                    setMode("diff");
                    return;
                  }
                  setError("");
                  setSaveFailure(null);
                  if (current?.content === latest.current) {
                    saved.current = latest.current;
                    clearDraft(draftId);
                  } else if (saveFailure) await save();
                } catch {
                  setError(
                    "Нет связи с сервером. Повторите попытку после восстановления соединения.",
                  );
                }
              }}
            >
              {saveFailure ? "Повторить сохранение" : "Перечитать состояние"}
            </button>
          ) : null}
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
      {recovery ? (
        <div className="wb-notice" role="status">
          В браузере остался несохранённый текст этого файла.
          <button
            type="button"
            onClick={() => {
              const copy = recovery;
              recoveryBase.current = copy.base;
              setRecovery(undefined);
              editText(copy.text);
              if (copy.base !== saved.current) {
                blocked.current = true;
                setNeedsMerge(true);
                setMode("diff");
              }
            }}
          >
            Восстановить текст
          </button>
          <button
            type="button"
            onClick={() => {
              clearDraft(draftId);
              setRecovery(undefined);
            }}
          >
            Удалить резервную копию
          </button>
        </div>
      ) : null}
      <div className="wb-layout">
        <aside className="wb-tree">
          <button
            className="wb-quick-open"
            type="button"
            onClick={() => {
              setSearchContent(false);
              setDialog("search");
            }}
          >
            <Search size={15} /> Найти файл <kbd>⌘/Ctrl P</kbd>
          </button>
          <FileExplorer
            canEdit={(path) =>
              state.files.some((file) => file.path === path && file.status !== "delete") &&
              !state.uploads?.some((file) => file.path === path)
            }
            onAction={async (action, path) => {
              if (action === "copy") {
                try {
                  await navigator.clipboard.writeText(path);
                  setNotice("Путь скопирован");
                } catch {
                  setNotice(`Путь файла: ${path}`);
                }
                return;
              }
              if (await openFile(path)) setDialog(action);
            }}
            storageKey={`pushdocs:folders:${projectId}:${branch}`}
            paths={explorerPaths}
            revealDirectory={revealDirectory}
            selected={selected}
            statuses={fileStatuses}
            statusError={statusError}
            readOnly={projectReadOnly}
            busy={busy}
            uploadProgress={uploadProgress}
            onUpload={async (files, directory) => {
              if (projectReadOnly || inFlight.current || busy || !(await save())) return;
              if (inFlight.current) return;
              inFlight.current = true;
              setBusy(true);
              try {
                const result = await uploadExplorerFiles({
                  files,
                  directory,
                  projectId,
                  branch,
                  reload: load,
                  onProgress: setUploadProgress,
                });
                if (result.uploaded.length) {
                  setRevealDirectory(directory);
                }
                setNotice(
                  [`Загружено файлов: ${result.uploaded.length}`, ...result.errors].join(". "),
                );
              } catch (cause) {
                setNotice(
                  cause instanceof Error ? cause.message : "Не удалось обновить список файлов",
                );
              } finally {
                inFlight.current = false;
                setBusy(false);
                setUploadProgress("");
              }
            }}
            onOpen={(path) => void openFile(path)}
            onCreate={(kind, directory) => {
              setCreateDirectory(directory);
              setDialog(kind);
            }}
            onRefresh={() => void receiveChanges()}
            onMedia={async () => {
              if (await save()) {
                setReplaceAttachment(undefined);
                setDialog("media");
              }
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
        </aside>
        <hr
          className="wb-resizer"
          aria-label="Ширина проводника"
          aria-orientation="vertical"
          aria-valuemin={200}
          aria-valuemax={600}
          aria-valuenow={explorerWidth}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const width = Math.max(
              200,
              Math.min(600, explorerWidth + (event.key === "ArrowRight" ? 20 : -20)),
            );
            setExplorerWidth(width);
            try {
              localStorage.setItem("pushdocs:explorer-width", String(width));
            } catch {}
          }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            const left = event.currentTarget.parentElement?.getBoundingClientRect().left ?? 0;
            const width = Math.max(200, Math.min(600, event.clientX - left));
            setExplorerWidth(width);
            try {
              localStorage.setItem("pushdocs:explorer-width", String(width));
            } catch {}
          }}
          onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
        />
        <section className={`wb-editor${commentsOpen && selected ? " wb-editor--discussing" : ""}`}>
          <div className="wb-document">
            <DocumentTabs
              tabs={tabs}
              selected={selected}
              statuses={fileStatuses}
              onOpen={(path) => void openFile(path)}
              onClose={(path) => void closeFile(path)}
              onReorder={setTabs}
            >
              <details className="wb-disclosure wb-tabs-menu">
                <summary aria-label="Действия с вкладками">
                  <MoreHorizontal size={16} />
                </summary>
                <div className="wb-popover">
                  <button
                    type="button"
                    disabled={tabs.length < 2}
                    onClick={() => {
                      setClosedTabs((current) =>
                        [...current, ...tabs.filter((path) => path !== selected)].slice(-20),
                      );
                      setTabs(selected ? [selected] : []);
                    }}
                  >
                    Закрыть остальные вкладки
                  </button>
                  <button
                    type="button"
                    disabled={!closedTabs.length}
                    onClick={async () => {
                      const path = closedTabs.at(-1);
                      if (path && (await openFile(path)))
                        setClosedTabs((current) => current.slice(0, -1));
                    }}
                  >
                    Вернуть закрытую вкладку
                  </button>
                </div>
              </details>
            </DocumentTabs>
            {selected ? (
              <>
                <div className="wb-filebar">
                  <div className="wb-document-heading">
                    <code title={selected}>{selected.split("/").join(" / ")}</code>
                  </div>
                  <div className="wb-save-info">
                    <span
                      aria-live="polite"
                      title="Черновик сохраняется в PushDocs. Для отправки в Git откройте «Изменения»."
                    >
                      {active && !busy && !dirty && !needsMerge ? <Check size={14} /> : null}
                      {state.role === "reader" || !active || saveFailure === "permission"
                        ? "Только чтение"
                        : needsMerge
                          ? "Автосохранение остановлено"
                          : saving
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
                    )
                      .filter(([value]) => isArticle || value === "source" || value === "diff")
                      .map(([value, label]) => (
                        <button
                          type="button"
                          key={value}
                          aria-selected={mode === value}
                          role="tab"
                          onClick={() => {
                            setJump(undefined);
                            setMode(value);
                          }}
                        >
                          {label}
                        </button>
                      ))}
                  </div>
                  <div className="wb-document-actions">
                    {isArticle ? (
                      <button
                        type="button"
                        aria-pressed={mode === "split"}
                        aria-label="Файл и просмотр рядом"
                        title="Файл и просмотр рядом"
                        onClick={() => setMode(mode === "split" ? "source" : "split")}
                      >
                        <Columns2 size={16} />
                      </button>
                    ) : null}
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
                {(mode === "source" || mode === "split") &&
                isArticle &&
                active?.status !== "delete" ? (
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
                          <Select
                            label="Компонент MDX"
                            options={components.map((item) => ({
                              label: item.label,
                              value: item.snippet,
                            }))}
                            value={component}
                            onValueChange={setComponent}
                          />
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
                        if (await save()) {
                          setReplaceAttachment(undefined);
                          setDialog("media");
                        }
                      }}
                    >
                      <Upload size={15} /> Вставить файл
                    </button>
                  </div>
                ) : null}
                {readOnlyReason ? (
                  <div className="wb-readonly-note" role="status">
                    {readOnlyReason}
                  </div>
                ) : null}
                <div className={`wb-document-body${mode === "split" ? " wb-split-view" : ""}`}>
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
                        <DiffViewer
                          path={selected}
                          key={selected}
                          before={active.baseContent}
                          after=""
                        />
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
                      {attachmentUrl ? (
                        <div className="wb-actions">
                          <button
                            type="button"
                            disabled={projectReadOnly}
                            onClick={() => {
                              setReplaceAttachment(selected);
                              setDialog("media");
                            }}
                          >
                            Заменить файл
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(attachmentUrl);
                                setNotice("Ссылка скопирована");
                              } catch {
                                setNotice(attachmentUrl);
                              }
                            }}
                          >
                            Копировать ссылку
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : mode === "source" || mode === "split" ? (
                    <>
                      <SourceEditor
                        path={selected}
                        key={selected}
                        storageKey={`pushdocs:position:${projectId}:${branch}:${selected}`}
                        jump={jump}
                        inputRef={textArea}
                        value={text}
                        readOnly={readOnly}
                        onChange={editText}
                        onSave={() => {
                          void save();
                        }}
                        onIndent={() => insert("  ")}
                      />
                      {mode === "split" ? (
                        <DocumentPreview
                          source={text}
                          projectId={projectId}
                          branch={branch}
                          path={selected}
                          repositoryPaths={explorerPaths}
                          locale={active?.locale ?? state.config.defaultLocale}
                          media={state.config.media}
                          onErrorLine={(line) => {
                            setMode("source");
                            setJump({ line, token: Date.now() });
                          }}
                        />
                      ) : null}
                    </>
                  ) : mode === "metadata" ? (
                    <MetadataEditor
                      value={text}
                      fields={state.config.metadata}
                      path={selected}
                      readOnly={readOnly || !/\.mdx?$/i.test(selected)}
                      onChange={editText}
                    />
                  ) : mode === "preview" ? (
                    <DocumentPreview
                      onErrorLine={(line) => {
                        setMode("source");
                        setJump({ line, token: Date.now() });
                      }}
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
                      path={selected}
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
                <details className="wb-replace" hidden={!active || active.status === "delete"}>
                  <summary>Найти и заменить в документе</summary>
                  <div>
                    <input
                      aria-label="Найти текст"
                      placeholder="Найти текст"
                      value={replace}
                      onChange={(event) => setReplace(event.target.value)}
                    />
                    <input
                      aria-label="Заменить на"
                      placeholder="Заменить на"
                      value={replacement}
                      onChange={(event) => setReplacement(event.target.value)}
                    />
                    <button
                      type="button"
                      disabled={
                        readOnly ||
                        !replacementPlan.count ||
                        replacementPlan.before === replacementPlan.after
                      }
                      onClick={() => setDialog("replace")}
                    >
                      Просмотреть замены
                    </button>
                  </div>
                  {replace ? (
                    <small role="status">Совпадений: {replacementPlan.count}</small>
                  ) : null}
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
            className={`wb-modal${dialog === "media" ? " wb-media-modal" : dialog === "replace" ? " wb-replacement-modal" : ""}`}
            ref={modal}
            role="dialog"
            aria-modal="true"
            aria-label={dialog === "replace" ? "Предпросмотр замены" : "Операция с проектом"}
          >
            <header>
              <h2>
                {
                  {
                    replace: "Предпросмотр замены",
                    search: "Поиск файлов",
                    new: "Новый файл",
                    folder: "Новая папка",
                    branch: "Новая ветка",
                    move: "Переместить файл",
                    rename: "Переименовать файл",
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
            {dialog === "replace" ? (
              <ReplacePreview
                path={selected}
                key={selected}
                source={text}
                find={replace}
                replacement={replacement}
                readOnly={readOnly}
                onCancel={() => setDialog(null)}
                onApply={(before, after) => {
                  if (readOnly || latest.current !== before) return;
                  editText(after);
                  setMode("source");
                  setDialog(null);
                }}
              />
            ) : dialog === "search" ? (
              <QuickOpen
                key={String(searchContent)}
                paths={explorerPaths}
                files={state.files.map((file) =>
                  file.path === selected ? { ...file, content: text } : file,
                )}
                initialContent={searchContent}
                onOpen={async (path, line) => {
                  if (await openFile(path)) {
                    setDialog(null);
                    if (line) setJump({ line, token: Date.now() });
                  }
                }}
              />
            ) : dialog === "media" ? (
              <MediaLibrary
                projectId={projectId}
                branch={branch}
                document={article}
                onBusyChange={setMediaBusy}
                replacePath={replaceAttachment}
                initialQuery={replaceAttachment?.split("/").at(-1)}
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
                dialog === "move" ||
                dialog === "rename" ? (
                  <label>
                    {dialog === "branch"
                      ? "Имя ветки"
                      : dialog === "folder"
                        ? "Путь папки"
                        : dialog === "rename"
                          ? "Имя файла"
                          : "Путь файла"}
                    <input
                      name="path"
                      required
                      defaultValue={
                        dialog === "new" || dialog === "folder"
                          ? `${createDirectory ? `${createDirectory}/` : ""}${dialog === "new" ? "new-file.mdx" : "new-folder"}`
                          : dialog === "rename"
                            ? selected.split("/").at(-1)
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
                {dialog === "move" || dialog === "rename" ? (
                  <p>
                    Перенос добавит новый путь и удалит прежний одним коммитом. Проверьте ссылки на
                    старый путь через поиск.
                  </p>
                ) : null}
                {dialog === "template" ? (
                  <>
                    <div className="form-field">
                      <label htmlFor="new-document-template">Шаблон</label>
                      <Select
                        defaultValue={state.config.templates[0]?.id}
                        id="new-document-template"
                        label="Шаблон"
                        name="template"
                        options={state.config.templates.map((item) => ({
                          label: item.label,
                          value: item.id,
                        }))}
                      />
                    </div>
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
