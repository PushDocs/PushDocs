"use client";

import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  CircleAlert,
  File,
  FileCode2,
  FileImage,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  RefreshCw,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { changedDirectories, fileStatusLabel } from "./file-status";

type Node = { path: string; name: string; directory: boolean; children: Map<string, Node> };
function isInternalPath(path: string) {
  return path === ".pushdocs" || path.startsWith(".pushdocs/");
}
export function buildFileTree(paths: string[]): Node[] {
  const root = new Map<string, Node>();
  for (const path of paths) {
    if (isInternalPath(path)) continue;
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
    return <FileImage size={15} className="wb-file-icon image" />;
  if (/\.(md|mdx|txt)$/i.test(path)) return <FileText size={15} className="wb-file-icon text" />;
  if (/\.(js|jsx|ts|tsx|json|yml|yaml|css|html|sh)$/i.test(path))
    return <FileCode2 size={15} className="wb-file-icon code" />;
  return <File size={15} className="wb-file-icon" />;
}
export function FileExplorer({
  paths,
  storageKey,
  onAction,
  canEdit,
  revealDirectory,
  selected,
  statuses,
  statusError,
  readOnly,
  busy,
  onOpen,
  onCreate,
  onRefresh,
  onMedia,
  onUpload,
  uploadProgress,
}: {
  paths: string[];
  storageKey?: string;
  onAction?: (action: "rename" | "move" | "copy", path: string) => void;
  canEdit?: (path: string) => boolean;
  revealDirectory?: string;
  selected: string;
  statuses: Map<string, string>;
  statusError?: string;
  readOnly: boolean;
  busy: boolean;
  onOpen: (path: string) => void;
  onCreate: (kind: "new" | "folder", directory: string) => void;
  onRefresh: () => void;
  onMedia?: () => void;
  onUpload?: (files: File[], directory: string) => void;
  uploadProgress?: string;
}) {
  const directories = useMemo(() => changedDirectories(statuses), [statuses]);
  const tree = useMemo(() => buildFileTree(paths), [paths]);
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
  useEffect(() => {
    setExpanded((current) => new Set([...current, ...parents(selected)]));
    setFocused(selected);
  }, [selected]);
  useEffect(() => {
    if (!revealDirectory) return;
    setExpanded((current) => new Set([...current, ...parents(revealDirectory), revealDirectory]));
    setFocused(revealDirectory);
  }, [revealDirectory]);
  const rows: Array<Node & { depth: number }> = [];
  function flatten(nodes: Node[], depth: number) {
    for (const node of nodes) {
      rows.push({ ...node, depth });
      if (expanded.has(node.path)) flatten(sortNodes(node.children), depth + 1);
    }
  }
  flatten(tree, 1);
  const focusNode = rows.find((node) => node.path === focused);
  const directory = isInternalPath(focused)
    ? ""
    : focusNode?.directory
      ? focusNode.path
      : focused.includes("/")
        ? focused.slice(0, focused.lastIndexOf("/"))
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
    if (!path) return;
    setFocused(path);
    requestAnimationFrame(() => {
      const button = [
        ...(container.current?.querySelectorAll<HTMLButtonElement>("[role=treeitem]") ?? []),
      ].find((item) => item.dataset.path === path);
      button?.focus();
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
            aria-label="Получить из Git"
            title="Получить из Git"
            disabled={busy}
            onClick={onRefresh}
          >
            <RefreshCw size={15} />
          </button>
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
        {rows.map((node, index) => (
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
            aria-expanded={node.directory ? expanded.has(node.path) : undefined}
            aria-selected={node.path === focused}
            tabIndex={node.path === focused || (!focusNode && index === 0) ? 0 : -1}
            className={`wb-explorer-row${node.path === selected && !node.directory ? " active" : ""}${node.path === focused ? " focused" : ""}${statuses.get(node.path) === "delete" ? " deleted" : ""}`}
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
              if (!["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"].includes(key))
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
        ))}
        {!tree.length ? <p className="wb-empty">Нет файлов</p> : null}
      </div>
      {dropDirectory !== undefined || uploadProgress || dropMessage ? (
        <div className="wb-explorer-upload-status" role="status">
          {uploadProgress || dropMessage || `Загрузить в ${dropDirectory || "/"}`}
        </div>
      ) : null}
    </>
  );
}
