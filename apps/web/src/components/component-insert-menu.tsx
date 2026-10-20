"use client";

import { ChevronDown, Puzzle } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

export function ComponentInsertMenu({
  components,
  readOnly,
  onInsert,
}: {
  components: Array<{ name: string; label: string; snippet: string }>;
  readOnly: boolean;
  onInsert: (snippet: string, name: string) => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    const element = menu.current;
    if (!open || !element) return;
    const updateHeight = () => {
      const availableHeight = window.innerHeight - element.getBoundingClientRect().top - 8;
      element.style.setProperty("--component-menu-space", `${Math.max(0, availableHeight)}px`);
    };
    updateHeight();
    window.addEventListener("resize", updateHeight);
    const observer =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(updateHeight);
    const toolbar = element.closest(".wb-format");
    if (toolbar) observer?.observe(toolbar);
    return () => {
      window.removeEventListener("resize", updateHeight);
      observer?.disconnect();
    };
  }, [open]);

  return (
    <details className="wb-disclosure" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <Puzzle size={16} /> Компонент <ChevronDown size={12} />
      </summary>
      <div ref={menu} className="wb-popover wb-component-list" role="menu">
        {components.map((item) => (
          <button
            key={`${item.label}:${item.snippet}`}
            type="button"
            role="menuitem"
            disabled={readOnly}
            onClick={(event) => {
              onInsert(item.snippet, item.name);
              event.currentTarget.closest("details")?.removeAttribute("open");
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </details>
  );
}
