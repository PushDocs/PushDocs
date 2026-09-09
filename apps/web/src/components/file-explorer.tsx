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
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { changedDirectories, fileStatusLabel } from "./file-status";

type Node = { path: string; name: string; directory: boolean; children: Map<string, Node> };
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
    return <FileImage size={15} className="wb-file-icon image" />;
  if (/\.(md|mdx|txt)$/i.test(path)) return <FileText size={15} className="wb-file-icon text" />;
  if (/\.(js|jsx|ts|tsx|json|yml|yaml|css|html|sh)$/i.test(path))
    return <FileCode2 size={15} className="wb-file-icon code" />;
  return <File size={15} className="wb-file-icon" />;
}
export function FileExplorer({
  paths,
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
}: {
  paths: string[];
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
}) {
  const directories = useMemo(() => changedDirectories(statuses), [statuses]);
  const tree = useMemo(() => buildFileTree(paths), [paths]);
  const [expanded, setExpanded] = useState(() => new Set(parents(selected)));
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
  const directory = focusNode?.directory
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
        <strong>Проводник</strong>
        {statusError ? (
          <span title={statusError} role="status" aria-label={statusError}>
            <CircleAlert size={14} />
          </span>
        ) : null}
        <div role="toolbar" aria-label="Действия с файлами">
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
            aria-label="Обновить файлы"
            title="Обновить файлы"
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
      <div className="wb-explorer" role="tree" aria-label="Файлы проекта" ref={container}>
        <button
          className="wb-explorer-root"
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
        {!paths.length ? <p className="wb-empty">Нет файлов</p> : null}
      </div>
    </>
  );
}
