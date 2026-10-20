type Listener = { ready: (url: string) => void; failed: () => void };
type Entry = {
  listeners: Set<Listener>;
  controller?: AbortController;
  url?: string;
  bytes: number;
};

/** One gallery session; cache entries are pinned while a visible card uses them. */
export class ThumbnailLoader {
  private entries = new Map<string, Entry>();
  private active = 0;
  private paused = true;

  constructor(
    private readonly concurrency = 4,
    private readonly maxEntries = 32,
    private readonly maxBytes = 24 * 1024 * 1024,
  ) {}

  setPaused(paused: boolean) {
    this.paused = paused;
    if (!paused) this.pump();
  }

  subscribe(src: string, ready: Listener["ready"], failed: Listener["failed"]) {
    const entry = this.entries.get(src) ?? { listeners: new Set<Listener>(), bytes: 0 };
    // Map order is also the LRU order.
    this.entries.delete(src);
    this.entries.set(src, entry);
    const listener = { ready, failed };
    entry.listeners.add(listener);
    if (entry.url) ready(entry.url);
    this.pump();
    return () => {
      entry.listeners.delete(listener);
      if (!entry.listeners.size && !entry.url) {
        if (this.entries.get(src) === entry) this.entries.delete(src);
        entry.controller?.abort();
      }
      this.trim();
    };
  }

  dispose() {
    this.paused = true;
    for (const entry of this.entries.values()) {
      entry.listeners.clear();
      entry.controller?.abort();
      if (entry.url) URL.revokeObjectURL(entry.url);
    }
    this.entries.clear();
  }

  private pump() {
    if (this.paused) return;
    for (const [src, entry] of this.entries) {
      if (this.active >= this.concurrency) break;
      if (entry.url || entry.controller || !entry.listeners.size) continue;
      const controller = new AbortController();
      entry.controller = controller;
      this.active++;
      void fetch(src, { signal: controller.signal })
        .then((response) => {
          if (!response.ok) throw new Error("Thumbnail unavailable");
          return response.blob();
        })
        .then((blob) => {
          if (controller.signal.aborted || this.entries.get(src) !== entry) return;
          entry.url = URL.createObjectURL(blob);
          entry.bytes = blob.size;
          for (const listener of entry.listeners) listener.ready(entry.url);
          this.trim();
        })
        .catch(() => {
          if (this.entries.get(src) === entry) this.entries.delete(src);
          if (!controller.signal.aborted) {
            for (const listener of entry.listeners) listener.failed();
          }
        })
        .finally(() => {
          // Aborting does not free a slot until fetch AND body reading have settled.
          this.active--;
          this.pump();
        });
    }
  }

  private trim() {
    let count = 0;
    let bytes = 0;
    for (const entry of this.entries.values()) {
      if (entry.url) {
        count++;
        bytes += entry.bytes;
      }
    }
    for (const [src, entry] of this.entries) {
      if (count <= this.maxEntries && bytes <= this.maxBytes) break;
      if (!entry.url || entry.listeners.size) continue;
      URL.revokeObjectURL(entry.url);
      this.entries.delete(src);
      count--;
      bytes -= entry.bytes;
    }
  }
}
