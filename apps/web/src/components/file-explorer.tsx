"use client";

import { defaultFileExplorerConfig } from "@pushdocs/contracts";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  CircleAlert,
  Eye,
  EyeOff,
  File,
  FileCode2,
  FileImage,
  FilePlus2,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
  FolderPlus,
  Languages,
  Upload,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { changedDirectories, fileStatusLabel } from "./file-status";

type Node = { path: string; name: string; directory: boolean; children: Map<string, Node> };
const defaultSystemDirectoriesVisible = false;
const fileIconSize = 15;

export function buildFileTree(paths: string[]): Node[] {
  const root = new Map<string, Node>();
  for (const path of paths) {
    const parts = path.split("/");
    let children = root;
    parts.forEach((name, index) => {
      const key = parts.slice(0, index + 1).join("/");
      let node = children.get(name);
      if (!node) {
        node = { name, path: key, directory: index < parts.length - 1, children: new Map() };
        children.set(name, node);
      }
      children = node.children;
    });
  }
  return sortNodes(root);
}
function sortNodes(nodes: Map<string, Node>) {
  return [...nodes.values()].sort(
    (a, b) =>
      Number(b.directory) - Number(a.directory) ||
      a.name.localeCompare(b.name, "en", { numeric: true }),
  );
}
function parents(path: string) {
  const parts = path.split("/");
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"));
}
export function ExplorerFileIcon({ path }: { path: string }) {
  if (/\.(png|jpe?g|gif|svg|webp|avif|ico)$/i.test(path))
    return <FileImage aria-hidden size={fileIconSize} className="wb-file-icon image" />;
  if (/\.(mp4|webm|mov|m4v|avi|mkv|mpeg|mpg|ogv)$/i.test(path))
    return <FileVideo aria-hidden size={fileIconSize} className="wb-file-icon video" />;
  if (/\.mdx?$/i.test(path) && /(?:^|\/)i18n\/[^/]+\//.test(path))
    return <Languages aria-hidden size={fileIconSize} className="wb-file-icon translation" />;
  if (/\.(md|mdx|txt)$/i.test(path))
    return <FileText aria-hidden size={fileIconSize} className="wb-file-icon text" />;
  if (/\.(js|jsx|ts|tsx|json|yml|yaml|css|html|sh)$/i.test(path))
    return <FileCode2 aria-hidden size={fileIconSize} className="wb-file-icon code" />;
  return <File aria-hidden size={fileIconSize} className="wb-file-icon" />;
}
export function FileExplorer({
  paths,
  storageKey,
  systemDirectories = defaultFileExplorerConfig.systemDirectories,
  visibilityStorageKey,
  onAction,
  canEdit,
  actionReason,
  revealDirectory,
  selected,
  statuses,
  statusError,
  readOnly,
  busy,
  onOpen,
  onCreate,
  onMedia,
  onUpload,
  uploadProgress,
}: {
  paths: string[];
  storageKey?: string;
  systemDirectories?: readonly string[];
  visibilityStorageKey?: string;
  onAction?: (action: "rename" | "move" | "copy" | "replace" | "delete", path: string) => void;
  canEdit?: (path: string) => boolean;
  actionReason?: (action: "replace" | "delete", path: string) => string;
  revealDirectory?: string;
  selected: string;
  statuses: Map<string, string>;
  statusError?: string;
  readOnly: boolean;
  busy: boolean;
  onOpen: (path: string) => void;
  onCreate: (kind: "new" | "folder", directory: string) => void;
  onMedia?: () => void;
  onUpload?: (files: File[], directory: string) => void;
  uploadProgress?: string;
}) {
  const [visibility, setVisibility] = useState({
    key: visibilityStorageKey,
    show: defaultSystemDirectoriesVisible,
  });
  const showSystemDirectories = visibility.key === visibilityStorageKey && visibility.show;
  useEffect(() => {
    let show = defaultSystemDirectoriesVisible;
    try {
      if (visibilityStorageKey) show = sessionStorage.getItem(visibilityStorageKey) === "true";
    } catch {}
    setVisibility({ key: visibilityStorageKey, show });
  }, [visibilityStorageKey]);
  function changeVisibility(show: boolean) {
    setVisibility({ key: visibilityStorageKey, show });
    setMenu(undefined);
    setDropDirectory(undefined);
    try {
      if (visibilityStorageKey) sessionStorage.setItem(visibilityStorageKey, String(show));
    } catch {}
  }
  const directories = useMemo(() => changedDirectories(statuses), [statuses]);
  const visiblePaths = useMemo(
    () =>
      showSystemDirectories
        ? paths
        : paths.filter((path) =>
            systemDirectories.every(
              (systemPath) => path !== systemPath && !path.startsWith(`${systemPath}/`),
            ),
          ),
    [paths, systemDirectories, showSystemDirectories],
  );
  const tree = useMemo(() => buildFileTree(visiblePaths), [visiblePaths]);
  const [expanded, setExpanded] = useState(() => new Set(parents(selected)));
  const [menu, setMenu] = useState<{ path: string; directory: boolean; x: number; y: number }>();
  const [dropDirectory, setDropDirectory] = useState<string>();
  const [dropMessage, setDropMessage] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!dropDirectory || readOnly || busy) return;
    const timer = setTimeout(
      () => setExpanded((current) => new Set([...current, dropDirectory])),
      650,
    );
    return () => clearTimeout(timer);
  }, [dropDirectory, readOnly, busy]);
  const menuElement = useRef<HTMLDivElement>(null);
  const restored = useRef(false);
  const initialSelected = useRef(selected);
  useEffect(() => {
    if (!storageKey) return;
    try {
      const cached = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
      if (Array.isArray(cached))
        setExpanded(
          new Set([
            ...cached.filter((path: unknown) => typeof path === "string"),
            ...parents(initialSelected.current),
          ]),
        );
    } catch {}
    restored.current = true;
  }, [storageKey]);
  useEffect(() => {
    if (storageKey && restored.current)
      try {
        sessionStorage.setItem(storageKey, JSON.stringify([...expanded]));
      } catch {}
  }, [storageKey, expanded]);
  useEffect(() => {
    if (!menu) return;
    menuElement.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const close = () => setMenu(undefined);
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        const row = [
          ...(container.current?.querySelectorAll<HTMLButtonElement>("[role=treeitem]") ?? []),
        ].find((item) => item.dataset.path === menu.path);
        row?.focus();
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const items = [
          ...(menuElement.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ??
            []),
        ];
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        items[(index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
      }
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", key);
    };
  }, [menu]);
  const [focused, setFocused] = useState(selected);
  const container = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 0 });
  useEffect(() => {
    setExpanded((current) => new Set([...current, ...parents(selected)]));
    setFocused(selected);
  }, [selected]);
  useEffect(() => {
    if (showSystemDirectories) {
      setExpanded((current) => new Set([...current, ...parents(selected)]));
      setFocused(selected);
    }
  }, [showSystemDirectories, selected]);
  useEffect(() => {
    if (!revealDirectory) return;
    setExpanded((current) => new Set([...current, ...parents(revealDirectory), revealDirectory]));
    setFocused(revealDirectory);
  }, [revealDirectory]);
  const rows = useMemo(() => {
    const result: Array<Node & { depth: number }> = [];
    function flatten(nodes: Node[], depth: number) {
      for (const node of nodes) {
        result.push({ ...node, depth });
        if (expanded.has(node.path)) flatten(sortNodes(node.children), depth + 1);
      }
    }
    flatten(tree, 1);
    return result;
  }, [tree, expanded]);
  const rowHeight = 27;
  const virtual = rows.length > 200;
  const viewportHeight = viewport.height || 600;
  const maxScrollTop = Math.max(0, (rows.length + 1) * rowHeight - viewportHeight);
  const visibleStart = virtual
    ? Math.max(
        0,
        Math.floor(Math.max(0, Math.min(viewport.top, maxScrollTop) - rowHeight) / rowHeight) - 8,
      )
    : 0;
  const visibleEnd = virtual
    ? Math.min(rows.length, visibleStart + Math.ceil(viewportHeight / rowHeight) + 16)
    : rows.length;
  const visibleRows = rows.slice(visibleStart, visibleEnd);
  const visibleFocused =
    rows.find((node) => node.path === focused)?.path ??
    parents(focused)
      .reverse()
      .find((path) => rows.some((node) => node.path === path)) ??
    "";
  const focusNode = rows.find((node) => node.path === visibleFocused);
  useEffect(() => {
    if (focused !== visibleFocused) setFocused(visibleFocused);
    if (menu && !rows.some((node) => node.path === menu.path)) setMenu(undefined);
  }, [focused, visibleFocused, menu, rows]);
  const selectedIndex = rows.findIndex((node) => node.path === selected);
  useLayoutEffect(() => {
    const element = container.current;
    /* v8 ignore next -- the layout effect follows attachment of the rendered tree ref. */
    if (!element) return;
    const height = element.clientHeight || 600;
    let top = Math.min(element.scrollTop, maxScrollTop);
    if (rows.length > 200) {
      const selectedTop = selectedIndex * rowHeight;
      if (selectedIndex >= 0 && (selectedTop < top || selectedTop + rowHeight > top + height)) {
        top = Math.max(0, selectedTop - height / 2);
      }
    }
    if (element.scrollTop !== top) element.scrollTop = top;
    setViewport((current) =>
      current.top === top && current.height === height ? current : { top, height },
    );
  }, [rows.length, selectedIndex, maxScrollTop]);
  const directory = focusNode?.directory
    ? focusNode.path
    : visibleFocused.includes("/")
      ? visibleFocused.slice(0, visibleFocused.lastIndexOf("/"))
      : "";
  function toggle(path: string, open: boolean) {
    setExpanded((current) => {
      const next = new Set(current);
      if (open) next.add(path);
      else next.delete(path);
      return next;
    });
  }
  function focus(path: string | undefined) {
    /* v8 ignore next -- every caller derives a path from a non-empty rendered row. */
    if (!path) return;
    setFocused(path);
    const index = rows.findIndex((node) => node.path === path);
    if (virtual && index >= 0 && container.current) {
      const nextTop = Math.max(0, index * rowHeight - viewportHeight / 2);
      container.current.scrollTop = nextTop;
      setViewport({ top: nextTop, height: viewportHeight });
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const button = [
          ...(container.current?.querySelectorAll<HTMLButtonElement>("[role=treeitem]") ?? []),
        ].find((item) => item.dataset.path === path);
        button?.focus();
      });
    });
  }
  return (
    <>
      <div className="wb-explorer-heading">
        {statusError ? (
          <span title={statusError} role="status" aria-label={statusError}>
            <CircleAlert size={14} />
          </span>
        ) : null}
        <div role="toolbar" aria-label="Действия с файлами">
          {systemDirectories.length ? (
            <button
              type="button"
              aria-label="Показывать системные файлы и папки"
              aria-pressed={showSystemDirectories}
              title={
                showSystemDirectories
                  ? "Скрыть системные файлы и папки"
                  : "Показать системные файлы и папки"
              }
              onClick={() => changeVisibility(!showSystemDirectories)}
            >
              {showSystemDirectories ? <Eye size={16} /> : <EyeOff size={16} />}
            </button>
          ) : null}
          {onUpload ? (
            <button
              type="button"
              aria-label="Загрузить файлы в папку"
              title={`Загрузить файлы в ${directory || "/"}`}
              disabled={readOnly || busy}
              onClick={() => picker.current?.click()}
            >
              <Upload size={16} />
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Новый файл"
            title="Новый файл"
            disabled={readOnly || busy}
            onClick={() => onCreate("new", directory)}
          >
            <FilePlus2 size={16} />
          </button>
          <button
            type="button"
            aria-label="Новая папка"
            title="Новая папка"
            disabled={readOnly || busy}
            onClick={() => onCreate("folder", directory)}
          >
            <FolderPlus size={16} />
          </button>
          {onMedia ? (
            <button
              type="button"
              aria-label="Вложения"
              title="Вложения: загрузить или выбрать файл"
              disabled={busy}
              onClick={onMedia}
            >
              <FileImage size={16} />
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Свернуть все папки"
            title="Свернуть все папки"
            onClick={() => {
              setExpanded(new Set());
              setFocused("");
            }}
          >
            <ChevronsDownUp size={15} />
          </button>
        </div>
      </div>
      {menu ? (
        <div
          ref={menuElement}
          className="wb-explorer-menu"
          role="menu"
          aria-label="Действия с файлом"
          style={{ left: menu.x, top: menu.y }}
        >
          {menu.directory ? (
            <>
              <button
                role="menuitem"
                type="button"
                disabled={readOnly}
                onClick={() => onCreate("new", menu.path)}
              >
                Новый файл
              </button>
              <button
                role="menuitem"
                type="button"
                disabled={readOnly}
                onClick={() => onCreate("folder", menu.path)}
              >
                Новая папка
              </button>
            </>
          ) : (
            <>
              {(["replace", "delete"] as const).map((action) => {
                const reason = actionReason?.(action, menu.path);
                return (
                  <button
                    key={action}
                    role="menuitem"
                    type="button"
                    title={reason || undefined}
                    disabled={readOnly || busy || !!reason}
                    onClick={() => onAction?.(action, menu.path)}
                  >
                    {action === "replace" ? "Заменить файл" : "Удалить файл"}
                    {reason ? <small>{reason}</small> : null}
                  </button>
                );
              })}
              <button
                role="menuitem"
                type="button"
                disabled={readOnly || !canEdit?.(menu.path)}
                onClick={() => onAction?.("rename", menu.path)}
              >
                Переименовать
              </button>
              <button
                role="menuitem"
                type="button"
                disabled={readOnly || !canEdit?.(menu.path)}
                onClick={() => onAction?.("move", menu.path)}
              >
                Переместить
              </button>
            </>
          )}
          <button role="menuitem" type="button" onClick={() => onAction?.("copy", menu.path)}>
            Копировать путь
          </button>
        </div>
      ) : null}
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        aria-label="Файлы для загрузки"
        disabled={readOnly || busy}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length && !readOnly && !busy) {
            setExpanded((current) => new Set([...current, ...parents(directory), directory]));
            onUpload?.(files, directory);
          }
        }}
      />
      <div
        className="wb-explorer"
        role="tree"
        aria-label="Файлы проекта"
        ref={container}
        data-drop-root={dropDirectory === "" || undefined}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          if (!onUpload || readOnly || busy) {
            event.dataTransfer.dropEffect = "none";
            return;
          }
          event.dataTransfer.dropEffect = "copy";
          setDropMessage("");
          const target = (event.target as Element).closest<HTMLElement>("[data-upload-directory]");
          setDropDirectory(target?.dataset.uploadDirectory ?? "");
          const box = event.currentTarget.getBoundingClientRect();
          if (event.clientY < box.top + 32) event.currentTarget.scrollTop -= 16;
          if (event.clientY > box.bottom - 32) event.currentTarget.scrollTop += 16;
        }}
        onDragLeave={(event) => {
          if (
            !(event.relatedTarget instanceof globalThis.Node) ||
            !event.currentTarget.contains(event.relatedTarget)
          )
            setDropDirectory(undefined);
        }}
        onDrop={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          setDropDirectory(undefined);
          if (!onUpload || readOnly || busy) return;
          if (
            Array.from(event.dataTransfer.items ?? []).some(
              (item) => item.webkitGetAsEntry?.()?.isDirectory,
            )
          ) {
            setDropMessage("Откройте папку на компьютере и перетащите нужные файлы.");
            return;
          }
          const target = (event.target as Element).closest<HTMLElement>("[data-upload-directory]");
          const destination = target?.dataset.uploadDirectory ?? "";
          const files = Array.from(event.dataTransfer.files);
          if (files.length) {
            setExpanded((current) => new Set([...current, ...parents(destination), destination]));
            setFocused(destination);
            onUpload(files, destination);
          }
        }}
        onScroll={(event) =>
          setViewport({
            top: event.currentTarget.scrollTop,
            height: event.currentTarget.clientHeight,
          })
        }
      >
        <button
          className="wb-explorer-root"
          data-upload-directory=""
          type="button"
          onClick={() => setFocused("")}
          title="Создавать файлы в корне проекта"
        >
          <FolderOpen size={15} /> /
        </button>
        {virtual && visibleStart > 0 ? (
          <div
            aria-hidden
            className="wb-explorer-spacer"
            style={{ height: visibleStart * rowHeight }}
          />
        ) : null}
        {visibleRows.map((node, visibleIndex) => {
          const index = visibleStart + visibleIndex;
          return (
            <button
              key={node.path}
              type="button"
              role="treeitem"
              data-path={node.path}
              data-upload-directory={
                node.directory ? node.path : node.path.split("/").slice(0, -1).join("/")
              }
              data-drop-target={(node.directory && node.path === dropDirectory) || undefined}
              data-status={
                node.directory
                  ? directories.has(node.path)
                    ? "modify"
                    : undefined
                  : statuses.get(node.path)
              }
              aria-description={
                node.directory && directories.has(node.path)
                  ? "Есть изменения внутри"
                  : fileStatusLabel[statuses.get(node.path) ?? ""]
              }
              aria-label={node.name}
              aria-level={node.depth}
              aria-posinset={index + 1}
              aria-setsize={rows.length}
              aria-expanded={node.directory ? expanded.has(node.path) : undefined}
              aria-selected={node.path === visibleFocused}
              tabIndex={node.path === visibleFocused || (!focusNode && index === 0) ? 0 : -1}
              className={`wb-explorer-row${node.path === selected && !node.directory ? " active" : ""}${node.path === visibleFocused ? " focused" : ""}${statuses.get(node.path) === "delete" ? " deleted" : ""}`}
              style={{ paddingLeft: 8 + (node.depth - 1) * 16 }}
              title={`${node.path}${node.directory && directories.has(node.path) ? " · Есть изменения внутри" : fileStatusLabel[statuses.get(node.path) ?? ""] ? ` · ${fileStatusLabel[statuses.get(node.path) ?? ""]}` : ""}`}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({
                  path: node.path,
                  directory: node.directory,
                  x: Math.min(event.clientX, window.innerWidth - 210),
                  y: Math.min(event.clientY, window.innerHeight - 160),
                });
              }}
              onClick={() => {
                setFocused(node.path);
                if (node.directory) toggle(node.path, !expanded.has(node.path));
                else onOpen(node.path);
              }}
              onKeyDown={(event) => {
                const key = event.key;
                if (
                  !["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"].includes(key)
                )
                  return;
                event.preventDefault();
                if (key === "ArrowDown") focus(rows[Math.min(index + 1, rows.length - 1)]?.path);
                if (key === "ArrowUp") focus(rows[Math.max(index - 1, 0)]?.path);
                if (key === "Home") focus(rows[0]?.path);
                if (key === "End") focus(rows.at(-1)?.path);
                if (key === "ArrowRight" && node.directory) {
                  if (!expanded.has(node.path)) toggle(node.path, true);
                  else if (rows[index + 1]?.depth === node.depth + 1) focus(rows[index + 1]?.path);
                }
                if (key === "ArrowLeft") {
                  if (node.directory && expanded.has(node.path)) toggle(node.path, false);
                  else {
                    const parent = parents(node.path).at(-1);
                    if (parent) focus(parent);
                  }
                }
              }}
            >
              {node.directory ? (
                <>
                  {expanded.has(node.path) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  {expanded.has(node.path) ? <FolderOpen size={15} /> : <Folder size={15} />}
                </>
              ) : (
                <>
                  <span className="wb-explorer-indent" />
                  <ExplorerFileIcon path={node.path} />
                </>
              )}
              <span className="wb-explorer-name">{node.name}</span>
              {node.directory && directories.has(node.path) ? (
                <span className="wb-explorer-status" aria-hidden="true">
                  ●
                </span>
              ) : fileStatusLabel[statuses.get(node.path) ?? ""] ? (
                <span className="wb-explorer-status" aria-hidden="true">
                  {statuses.get(node.path) === "add"
                    ? "A"
                    : statuses.get(node.path) === "delete"
                      ? "D"
                      : "M"}
                </span>
              ) : null}
            </button>
          );
        })}
        {virtual && visibleEnd < rows.length ? (
          <div
            aria-hidden
            className="wb-explorer-spacer"
            style={{ height: (rows.length - visibleEnd) * rowHeight }}
          />
        ) : null}
        {!tree.length ? (
          <div className="wb-empty">
            {paths.length && !showSystemDirectories ? (
              <>
                <p>Системные файлы и папки скрыты</p>
                <button type="button" onClick={() => changeVisibility(true)}>
                  Показать
                </button>
              </>
            ) : (
              <p>Нет файлов</p>
            )}
          </div>
        ) : null}
      </div>
      {dropDirectory !== undefined || uploadProgress || dropMessage ? (
        <div className="wb-explorer-upload-status" role="status">
          {uploadProgress || dropMessage || `Загрузить в ${dropDirectory || "/"}`}
        </div>
      ) : null}
    </>
  );
}
