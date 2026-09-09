"use client";
import { FileText } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { ReviewFile } from "./change-review";

const ROW_HEIGHT = 48;
const OVERSCAN = 6;

export function ChangeFileList({
  files,
  selectedPath,
  onSelect,
}: {
  files: ReviewFile[];
  selectedPath?: string;
  onSelect: (path: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const [viewport, setViewport] = useState({ height: 480, top: 0 });
  const selectedIndex = files.findIndex((file) => file.path === selectedPath);
  const maxTop = Math.max(0, files.length * ROW_HEIGHT - viewport.height);
  const top = Math.min(viewport.top, maxTop);
  const start = Math.max(0, Math.floor(top / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(files.length, Math.ceil((top + viewport.height) / ROW_HEIGHT) + OVERSCAN);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => setViewport({ height: list.clientHeight || 480, top: list.scrollTop });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (!list || selectedIndex < 0) return;
    const rowTop = selectedIndex * ROW_HEIGHT;
    const height = list.clientHeight || viewport.height;
    const nextTop =
      rowTop < list.scrollTop
        ? rowTop
        : rowTop + ROW_HEIGHT > list.scrollTop + height
          ? rowTop + ROW_HEIGHT - height
          : list.scrollTop;
    list.scrollTop = nextTop;
    setViewport((value) => (value.top === nextTop ? value : { ...value, top: nextTop }));
  }, [selectedIndex, viewport.height]);

  return (
    <div
      className="change-file-list"
      ref={listRef}
      role="listbox"
      aria-label="Изменённые файлы"
      tabIndex={0}
      aria-activedescendant={
        selectedIndex >= start && selectedIndex < end ? `${id}-${selectedIndex}` : undefined
      }
      onScroll={(event) => {
        const scrollTop = event.currentTarget.scrollTop;
        setViewport((value) => ({ ...value, top: scrollTop }));
      }}
      onKeyDown={(event) => {
        const pageSize = Math.max(1, Math.floor(viewport.height / ROW_HEIGHT));
        const destination = {
          ArrowDown: selectedIndex + 1,
          ArrowUp: selectedIndex - 1,
          Home: 0,
          End: files.length - 1,
          PageDown: selectedIndex + pageSize,
          PageUp: selectedIndex - pageSize,
        }[event.key];
        if (destination === undefined || !files.length) return;
        event.preventDefault();
        const file = files[Math.max(0, Math.min(files.length - 1, destination))];
        if (file) onSelect(file.path);
      }}
    >
      <div className="change-file-list-space" style={{ height: files.length * ROW_HEIGHT }}>
        {files.slice(start, end).map((file, offset) => {
          const index = start + offset;
          const separator = file.path.lastIndexOf("/");
          const status = file.operation === "add" ? "A" : file.operation === "delete" ? "D" : "M";
          return (
            <button
              className="change-file-option"
              type="button"
              role="option"
              id={`${id}-${index}`}
              key={file.path}
              tabIndex={-1}
              aria-selected={file.path === selectedPath}
              aria-label={`${file.path} ${status}`}
              aria-posinset={index + 1}
              aria-setsize={files.length}
              title={file.path}
              data-operation={file.operation}
              style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
              onClick={() => {
                onSelect(file.path);
                listRef.current?.focus({ preventScroll: true });
              }}
            >
              <FileText aria-hidden size={16} />
              <span>
                <strong>{file.path.slice(separator + 1)}</strong>
                {separator >= 0 ? <small>{file.path.slice(0, separator)}</small> : null}
              </span>
              <b
                title={
                  file.operation === "add"
                    ? "Новый файл"
                    : file.operation === "delete"
                      ? "Удалён"
                      : "Изменён"
                }
              >
                {status}
              </b>
            </button>
          );
        })}
      </div>
    </div>
  );
}
