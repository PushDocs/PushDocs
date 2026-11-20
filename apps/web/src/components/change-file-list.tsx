"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ChangeFileGroup } from "./change-file-groups";
import type { ReviewFile } from "./change-review";
import { ExplorerFileIcon } from "./file-explorer";

const ROW_HEIGHT = 48;
const GROUP_HEADER_HEIGHT = 40;
const DEFAULT_VIEWPORT_HEIGHT = 480;
const OVERSCAN = 6;

export function ChangeFileList({
  groups,
  selectedPath,
  onSelect,
}: {
  groups: ChangeFileGroup<ReviewFile>[];
  selectedPath?: string;
  onSelect: (path: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const [viewport, setViewport] = useState({ height: DEFAULT_VIEWPORT_HEIGHT, top: 0 });
  const files = useMemo(() => groups.flatMap((group) => group.files), [groups]);
  const layout = useMemo(() => {
    let top = 0;
    let index = 0;
    return groups.map((group) => {
      const height = GROUP_HEADER_HEIGHT + group.files.length * ROW_HEIGHT;
      const position = { ...group, top, index, height };
      top += height;
      index += group.files.length;
      return position;
    });
  }, [groups]);
  const totalHeight = files.length * ROW_HEIGHT + groups.length * GROUP_HEADER_HEIGHT;
  const selectedIndex = files.findIndex((file) => file.path === selectedPath);
  const maxTop = Math.max(0, totalHeight - viewport.height);
  const top = Math.min(viewport.top, maxTop);
  const ranges = layout.map((group) => {
    const filesTop = group.top + GROUP_HEADER_HEIGHT;
    return {
      ...group,
      start: Math.min(
        group.files.length,
        Math.max(0, Math.floor((top - filesTop) / ROW_HEIGHT) - OVERSCAN),
      ),
      end: Math.max(
        0,
        Math.min(
          group.files.length,
          Math.ceil((top + viewport.height - filesTop) / ROW_HEIGHT) + OVERSCAN,
        ),
      ),
    };
  });
  const selectedMounted = ranges.some(
    (group) =>
      selectedIndex >= group.index + group.start && selectedIndex < group.index + group.end,
  );

  useEffect(() => {
    const list = listRef.current;
    /* v8 ignore next -- the effect only runs after React attaches this rendered list ref. */
    if (!list) return;
    const measure = () =>
      setViewport({ height: list.clientHeight || DEFAULT_VIEWPORT_HEIGHT, top: list.scrollTop });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (!list || selectedIndex < 0) return;
    const group = layout.find(
      (entry) => selectedIndex >= entry.index && selectedIndex < entry.index + entry.files.length,
    );
    if (!group) return;
    const rowTop = group.top + GROUP_HEADER_HEIGHT + (selectedIndex - group.index) * ROW_HEIGHT;
    const revealTop = selectedIndex === group.index ? group.top : rowTop;
    const height = list.clientHeight || viewport.height;
    const nextTop =
      revealTop < list.scrollTop
        ? revealTop
        : rowTop + ROW_HEIGHT > list.scrollTop + height
          ? rowTop + ROW_HEIGHT - height
          : list.scrollTop;
    list.scrollTop = nextTop;
    setViewport((value) => (value.top === nextTop ? value : { ...value, top: nextTop }));
  }, [layout, selectedIndex, viewport.height]);

  return (
    <div
      className="change-file-list"
      ref={listRef}
      role="listbox"
      aria-label="Изменённые файлы"
      tabIndex={0}
      aria-activedescendant={selectedMounted ? `${id}-${selectedIndex}` : undefined}
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
      <div className="change-file-list-space" role="presentation" style={{ height: totalHeight }}>
        {ranges.map((group) => {
          return (
            // biome-ignore lint/a11y/useSemanticElements: listbox option groups use ARIA group semantics.
            <div
              className="change-file-group"
              key={group.kind}
              role="group"
              aria-labelledby={`${id}-${group.kind}`}
              style={{ top: group.top, height: group.height }}
            >
              <div className="change-file-group-heading" style={{ height: GROUP_HEADER_HEIGHT }}>
                <strong id={`${id}-${group.kind}`}>{group.label}</strong>
                <span>{group.files.length}</span>
              </div>
              {group.files.slice(group.start, group.end).map((file, offset) => {
                const localIndex = group.start + offset;
                const index = group.index + localIndex;
                const separator = file.path.lastIndexOf("/");
                const status =
                  file.operation === "add" ? "A" : file.operation === "delete" ? "D" : "M";
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
                    style={{
                      top: GROUP_HEADER_HEIGHT + localIndex * ROW_HEIGHT,
                      height: ROW_HEIGHT,
                    }}
                    onClick={() => {
                      onSelect(file.path);
                      listRef.current?.focus({ preventScroll: true });
                    }}
                  >
                    <ExplorerFileIcon path={file.path} />
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
          );
        })}
      </div>
    </div>
  );
}
