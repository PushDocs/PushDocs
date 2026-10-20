"use client";

import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { MediaPreviewProvider } from "./media-preview";

type Group<T> = { id: string; label: string; directory?: string; assets: T[] };
type GalleryProps<T> = {
  groups: Group<T>[];
  scrollRef: RefObject<HTMLElement | null>;
  resetKey: string;
  renderAsset: (asset: T, directory?: string) => ReactNode;
};

export function MediaGallery<T extends { path: string }>({
  groups,
  scrollRef,
  resetKey,
  renderAsset,
}: GalleryProps<T>) {
  const previousQuery = useRef(resetKey);
  useLayoutEffect(() => {
    if (previousQuery.current !== resetKey && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
    previousQuery.current = resetKey;
  }, [resetKey, scrollRef]);
  return (
    <MediaPreviewProvider scrollRef={scrollRef}>
      {groups.reduce((count, group) => count + group.assets.length, 0) > 60 ? (
        <VirtualMediaGroups groups={groups} scrollRef={scrollRef} renderAsset={renderAsset} />
      ) : (
        <div className="media-groups">
          {groups.map((group) => (
            <section className="media-group" key={group.id} aria-label={group.label}>
              <header>
                <h3>{group.label}</h3>
                <span>{group.assets.length}</span>
              </header>
              <div className="asset-grid">
                {group.assets.map((asset) => renderAsset(asset, group.directory))}
              </div>
            </section>
          ))}
        </div>
      )}
    </MediaPreviewProvider>
  );
}

function VirtualMediaGroups<T extends { path: string }>({
  groups,
  scrollRef,
  renderAsset,
}: Omit<GalleryProps<T>, "resetKey">) {
  const container = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ columns: 1, width: 0, margin: 0 });
  const [focusedRow, setFocusedRow] = useState<number>();
  const rows = useMemo(
    () =>
      groups.flatMap((group, groupIndex) => {
        const entries: Array<{
          key: string;
          group: Group<T>;
          assets?: T[];
          firstGroup?: boolean;
          lastRow?: boolean;
        }> = [{ key: `${group.id}:heading`, group, firstGroup: groupIndex === 0 }];
        for (let index = 0; index < group.assets.length; index += layout.columns) {
          entries.push({
            key: `${group.id}:${group.assets[index]?.path}:${layout.columns}`,
            group,
            assets: group.assets.slice(index, index + layout.columns),
            lastRow: index + layout.columns >= group.assets.length,
          });
        }
        return entries;
      }),
    [groups, layout.columns],
  );
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: useCallback((index: number) => rows[index]?.key ?? index, [rows]),
    estimateSize: (index) => (rows[index]?.assets ? 320 : 64),
    scrollMargin: layout.margin,
    overscan: 1,
    rangeExtractor: (range) => {
      const indices = defaultRangeExtractor(range);
      // Scrolling must not unmount the button currently holding keyboard focus.
      if (focusedRow !== undefined && focusedRow < rows.length && !indices.includes(focusedRow)) {
        indices.push(focusedRow);
        indices.sort((a, b) => a - b);
      }
      return indices;
    },
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: data changes can shift the list below upload/confirmation controls
  useLayoutEffect(() => {
    const measure = () => {
      const element = scrollRef.current;
      const grid = probe.current;
      const list = container.current;
      if (!element || !grid || !list) return;
      const columns = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(" ").length);
      const width = grid.getBoundingClientRect().width;
      const margin =
        list.getBoundingClientRect().top -
        element.getBoundingClientRect().top +
        element.scrollTop -
        element.clientTop;
      setLayout((current) =>
        current.columns === columns && current.width === width && current.margin === margin
          ? current
          : { columns, width, margin },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (probe.current) observer.observe(probe.current);
    // Upload progress, errors and deletion confirmation can shift the list's origin.
    for (const child of scrollRef.current?.children ?? []) observer.observe(child);
    if (scrollRef.current) observer.observe(scrollRef.current);
    return () => observer.disconnect();
  }, [scrollRef, groups]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: invalidate cached heights when card width changes
  useLayoutEffect(() => virtualizer.measure(), [virtualizer, layout.width, layout.columns]);
  const items = virtualizer.getVirtualItems();
  return (
    <div
      className="media-groups media-groups-virtual"
      ref={container}
      style={{ height: virtualizer.getTotalSize() }}
      onFocusCapture={(event) => {
        const row = event.target.closest<HTMLElement>("[data-index]");
        if (row) setFocusedRow(Number(row.dataset.index));
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocusedRow(undefined);
      }}
    >
      <div className="asset-grid media-grid-probe" ref={probe} aria-hidden />
      {groups.map((group) => {
        const groupItems = items.filter((item) => rows[item.index]?.group.id === group.id);
        if (!groupItems.length) return null;
        return (
          <section
            className="media-group media-group-virtual"
            key={group.id}
            aria-label={group.label}
          >
            {groupItems.map((item) => {
              const row = rows[item.index];
              if (!row) return null;
              return (
                <div
                  key={item.key}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  className={`media-virtual-row${row.assets ? " asset-grid" : " media-virtual-heading"}`}
                  style={{
                    transform: `translateY(${item.start - layout.margin}px)`,
                    gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
                    paddingTop: !row.assets && !row.firstGroup ? 28 : undefined,
                    paddingBottom: row.lastRow ? 0 : undefined,
                  }}
                >
                  {row.assets ? (
                    row.assets.map((asset) => renderAsset(asset, group.directory))
                  ) : (
                    <header className="media-group-heading">
                      <h3>{group.label}</h3>
                      <span>{group.assets.length}</span>
                    </header>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
