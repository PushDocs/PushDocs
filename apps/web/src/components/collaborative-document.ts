import * as Y from "yjs";

export interface SharedDocumentReply {
  epoch: string;
  update: string;
  vector: string;
  content?: string;
  revision: number;
  changeSetId?: string;
}
export interface SharedDocumentRequest {
  epoch?: string;
  update?: string;
  vector?: string;
}
export class CollaborationError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export const encodeSharedBytes = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};
export const decodeSharedBytes = (value: string): Uint8Array =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

export function hasSharedDraft(storage: Pick<Storage, "getItem">, key: string): boolean {
  const doc = new Y.Doc();
  try {
    const cached = JSON.parse(storage.getItem(key) ?? "null");
    if (
      !cached ||
      typeof cached.epoch !== "string" ||
      typeof cached.state !== "string" ||
      typeof cached.vector !== "string"
    )
      return false;
    Y.applyUpdate(doc, decodeSharedBytes(cached.state));
    Y.decodeStateVector(decodeSharedBytes(cached.vector));
    return doc.getText("source").length <= 5_000_000;
  } catch {
    return false;
  } finally {
    doc.destroy();
  }
}

/** Owns operation identity, acknowledgements and local undo independently of transport/editor. */
export class CollaborativeDocument {
  doc = new Y.Doc();
  source = this.doc.getText("source");
  private readonly local = {};
  history = new Y.UndoManager(this.source, { trackedOrigins: new Set([this.local]) });
  private epoch?: string;
  private serverVector?: Uint8Array;
  private acknowledged = new Y.Doc();
  private pending = false;
  private generation = 0;
  private running: Promise<boolean> | null = null;
  private stopped = false;
  private blocked = false;
  private ready = false;
  private observer = (_event: Y.YTextEvent, transaction: Y.Transaction) => {
    if (transaction.origin !== "server") {
      this.pending = true;
      this.generation++;
    }
    this.remember();
    this.options.onText(this.source.toString(), this.pending);
  };
  constructor(
    private readonly options: {
      exchange: (input: SharedDocumentRequest) => Promise<SharedDocumentReply>;
      onText: (text: string, pending: boolean) => void;
      onSaved: (reply: SharedDocumentReply & { content: string }, pending: boolean) => void;
      onError: (error: unknown) => void;
      storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
      key?: string;
    },
  ) {
    try {
      const cached = options.key
        ? JSON.parse(options.storage?.getItem(options.key) ?? "null")
        : null;
      if (cached && typeof cached.epoch === "string" && typeof cached.state === "string") {
        const state = decodeSharedBytes(cached.state);
        const vector = decodeSharedBytes(cached.vector);
        Y.applyUpdate(this.doc, state, "server");
        this.epoch = cached.epoch;
        this.serverVector = vector;
        this.pending = !!cached.pending;
        this.ready = true;
      }
    } catch {
      this.doc.destroy();
      this.doc = new Y.Doc();
      this.source = this.doc.getText("source");
      this.history.destroy();
      this.history = new Y.UndoManager(this.source, { trackedOrigins: new Set([this.local]) });
      this.epoch = undefined;
      this.serverVector = undefined;
      /* A corrupt cache must not prevent opening a document. */
    }
    Y.applyUpdate(this.acknowledged, Y.encodeStateAsUpdate(this.doc), "server");
    this.source.observe(this.observer);
  }
  get isReady() {
    return this.ready;
  }
  get hasPendingChanges() {
    return this.pending;
  }
  get text() {
    return this.source.toString();
  }
  edit(text: string) {
    if (!this.ready || this.blocked || this.stopped || text === this.text) return;
    const before = this.text;
    let start = 0;
    while (start < before.length && start < text.length && before[start] === text[start]) start++;
    let end = 0;
    while (
      end < before.length - start &&
      end < text.length - start &&
      before[before.length - end - 1] === text[text.length - end - 1]
    )
      end++;
    this.doc.transact(() => {
      this.source.delete(start, before.length - start - end);
      this.source.insert(start, text.slice(start, text.length - end));
    }, this.local);
  }
  undo() {
    if (this.ready && !this.blocked && !this.stopped) this.history.undo();
  }
  redo() {
    if (this.ready && !this.blocked && !this.stopped) this.history.redo();
  }
  private remember() {
    if (!this.options.key || !this.epoch || !this.serverVector) return;
    try {
      this.options.storage?.setItem(
        this.options.key,
        JSON.stringify({
          epoch: this.epoch,
          state: encodeSharedBytes(Y.encodeStateAsUpdate(this.doc)),
          vector: encodeSharedBytes(this.serverVector),
          pending: this.pending,
        }),
      );
    } catch {
      /* Workbench also keeps a plain-text recovery draft. */
    }
  }
  sync(): Promise<boolean> {
    if (this.stopped || this.blocked) return Promise.resolve(false);
    if (this.running) return this.running;
    this.running = this.exchange().finally(() => {
      this.running = null;
    });
    return this.running;
  }
  private async exchange(): Promise<boolean> {
    try {
      do {
        const generation = this.generation;
        let reply: SharedDocumentReply;
        const outgoing =
          this.epoch && this.pending
            ? encodeSharedBytes(Y.encodeStateAsUpdate(this.doc, this.serverVector))
            : undefined;
        try {
          reply = await this.options.exchange({
            epoch: this.epoch,
            vector: this.epoch ? encodeSharedBytes(Y.encodeStateVector(this.doc)) : undefined,
            update: outgoing,
          });
        } catch (error) {
          if (
            !(error instanceof CollaborationError) ||
            error.status !== 409 ||
            this.pending ||
            !this.epoch
          )
            throw error;
          reply = await this.options.exchange({});
          if (this.pending) throw error;
          if (this.stopped) return false;
          this.acknowledged.destroy();
          this.acknowledged = new Y.Doc();
          this.source.unobserve(this.observer);
          this.history.destroy();
          this.doc.destroy();
          this.doc = new Y.Doc();
          this.source = this.doc.getText("source");
          this.history = new Y.UndoManager(this.source, { trackedOrigins: new Set([this.local]) });
          this.source.observe(this.observer);
        }
        if (this.stopped) return false;
        this.epoch = reply.epoch;
        if (outgoing) Y.applyUpdate(this.acknowledged, decodeSharedBytes(outgoing), "server");
        Y.applyUpdate(this.acknowledged, decodeSharedBytes(reply.update), "server");
        Y.applyUpdate(this.doc, decodeSharedBytes(reply.update), "server");
        this.serverVector = decodeSharedBytes(reply.vector);
        this.pending = generation !== this.generation;
        this.ready = true;
        this.remember();
        this.options.onText(this.text, this.pending);
        this.options.onSaved(
          { ...reply, content: this.acknowledged.getText("source").toString() },
          this.pending,
        );
      } while (this.pending && !this.stopped);
      return true;
    } catch (error) {
      if (
        error instanceof CollaborationError &&
        (error.status === 409 || error.status === 403 || error.status === 401)
      )
        this.blocked = true;
      this.options.onError(error);
      return false;
    }
  }
  stop() {
    this.stopped = true;
    this.remember();
    this.source.unobserve(this.observer);
    this.history.destroy();
    this.doc.destroy();
    this.acknowledged.destroy();
  }
}
