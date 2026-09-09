"use client";

import { X } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { ExplorerFileIcon } from "./file-explorer";
import { fileStatusLabel } from "./file-status";

export function DocumentTabs({
  tabs,
  selected,
  statuses,
  onOpen,
  onClose,
  onReorder,
  children,
}: {
  tabs: string[];
  selected: string;
  statuses: Map<string, string>;
  onOpen: (path: string) => void;
  onClose: (path: string) => void;
  onReorder: (paths: string[]) => void;
  children?: ReactNode;
}) {
  const dragging = useRef<string | undefined>(undefined);
  const [destination, setDestination] = useState<{ path: string; after: boolean }>();
  function finish() {
    dragging.current = undefined;
    setDestination(undefined);
  }
  function move(path: string, target: string, after: boolean) {
    if (path === target || !tabs.includes(path) || !tabs.includes(target)) return;
    const next = tabs.filter((item) => item !== path);
    next.splice(next.indexOf(target) + Number(after), 0, path);
    if (next.some((item, index) => item !== tabs[index])) onReorder(next);
  }
  return (
    <div className="wb-tabs" role="tablist" aria-label="Открытые документы">
      {tabs.map((path) => (
        // biome-ignore lint/a11y/noStaticElementInteractions: The drop target includes both controls; keyboard reordering is handled by the tab button.
        <div
          className="wb-tab-item"
          key={path}
          data-active={path === selected}
          data-status={statuses.get(path)}
          data-drop={
            destination?.path === path ? (destination.after ? "after" : "before") : undefined
          }
          title={`${path}${fileStatusLabel[statuses.get(path) ?? ""] ? ` · ${fileStatusLabel[statuses.get(path) ?? ""]}` : ""}`}
          onDragOver={(event) => {
            if (!dragging.current) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            const rect = event.currentTarget.getBoundingClientRect();
            setDestination(
              dragging.current === path
                ? undefined
                : { path, after: event.clientX > rect.left + rect.width / 2 },
            );
            const strip = event.currentTarget.parentElement;
            if (strip) {
              const bounds = strip.getBoundingClientRect();
              if (event.clientX < bounds.left + 36) strip.scrollLeft -= 24;
              else if (event.clientX > bounds.right - 36) strip.scrollLeft += 24;
            }
          }}
          onDrop={(event) => {
            if (!dragging.current) return;
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            move(dragging.current, path, event.clientX > rect.left + rect.width / 2);
            finish();
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
              setDestination(undefined);
          }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={path === selected}
            aria-keyshortcuts="Alt+Shift+ArrowLeft Alt+Shift+ArrowRight"
            draggable
            onDragStart={(event) => {
              dragging.current = path;
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", path);
              const tab = event.currentTarget.parentElement;
              if (tab) event.dataTransfer.setDragImage(tab, 16, 16);
            }}
            onDragEnd={finish}
            onKeyDown={(event) => {
              if (
                !event.altKey ||
                !event.shiftKey ||
                !["ArrowLeft", "ArrowRight"].includes(event.key)
              )
                return;
              event.preventDefault();
              const after = event.key === "ArrowRight";
              const target = tabs[tabs.indexOf(path) + (after ? 1 : -1)];
              if (target) move(path, target, after);
            }}
            onClick={() => onOpen(path)}
          >
            <ExplorerFileIcon path={path} />{" "}
            <span className="wb-tab-name">{path.split("/").at(-1)}</span>
          </button>
          <button
            type="button"
            className="wb-tab-close"
            aria-label={`Закрыть ${path}`}
            onClick={() => onClose(path)}
          >
            <X size={13} aria-hidden />
          </button>
        </div>
      ))}
      {children}
    </div>
  );
}
