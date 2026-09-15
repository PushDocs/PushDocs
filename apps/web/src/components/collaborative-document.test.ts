// @vitest-environment jsdom
import { expect, it } from "vitest";
import * as Y from "yjs";
import {
  CollaborationError,
  CollaborativeDocument,
  decodeSharedBytes,
  encodeSharedBytes,
  type SharedDocumentReply,
  type SharedDocumentRequest,
} from "./collaborative-document";

function server() {
  const doc = new Y.Doc();
  doc.getText("source").insert(0, "abc");
  let revision = 0;
  const exchange = async (input: SharedDocumentRequest): Promise<SharedDocumentReply> => {
    if (input.update) {
      Y.applyUpdate(doc, decodeSharedBytes(input.update));
      revision++;
    }
    return {
      epoch: "epoch",
      revision,
      vector: encodeSharedBytes(Y.encodeStateVector(doc)),
      update: encodeSharedBytes(
        Y.encodeStateAsUpdate(doc, input.vector ? decodeSharedBytes(input.vector) : undefined),
      ),
    };
  };
  return { doc, exchange };
}
function client(
  exchange: (input: SharedDocumentRequest) => Promise<SharedDocumentReply>,
  storage?: Storage,
) {
  let error: unknown;
  const session = new CollaborativeDocument({
    exchange,
    onText: () => {},
    onSaved: () => {},
    onError: (value) => {
      error = value;
    },
    storage,
    key: "document",
  });
  return {
    session,
    get error() {
      return error;
    },
  };
}
it("converges concurrent same-position insertions and undoes only the local author", async () => {
  const remote = server();
  const alice = client(remote.exchange).session;
  const bob = client(remote.exchange).session;
  await alice.sync();
  await bob.sync();
  alice.edit("aXbc");
  bob.edit("aYbc");
  await alice.sync();
  await bob.sync();
  await alice.sync();
  expect(alice.text).toBe(bob.text);
  expect(["aXYbc", "aYXbc"]).toContain(alice.text);
  alice.undo();
  await alice.sync();
  await bob.sync();
  expect(alice.text).toBe("aYbc");
  expect(bob.text).toBe("aYbc");
  alice.redo();
  await alice.sync();
  await bob.sync();
  expect(bob.text).toBe(alice.text);
  alice.stop();
  bob.stop();
  remote.doc.destroy();
});
it("retains offline operations through reload and merges remote changes on reconnect", async () => {
  localStorage.clear();
  const remote = server();
  let online = true;
  const exchange = async (input: SharedDocumentRequest) => {
    if (!online) throw new Error("offline");
    return remote.exchange(input);
  };
  const first = client(exchange, localStorage).session;
  await first.sync();
  online = false;
  first.edit("Xabc");
  expect(await first.sync()).toBe(false);
  first.stop();
  const bob = client(remote.exchange).session;
  await bob.sync();
  bob.edit("abcY");
  await bob.sync();
  const resumed = client(exchange, localStorage).session;
  expect(resumed.isReady).toBe(true);
  expect(resumed.text).toBe("Xabc");
  resumed.edit("ZXabc");
  online = true;
  await resumed.sync();
  await bob.sync();
  expect(resumed.text).toBe("ZXabcY");
  expect(bob.text).toBe("ZXabcY");
  resumed.stop();
  bob.stop();
  remote.doc.destroy();
  localStorage.clear();
});
it("resends an unacknowledged operation without duplicating text", async () => {
  const remote = server();
  let loseReply = false;
  const value = client(async (input) => {
    const result = await remote.exchange(input);
    if (loseReply) {
      loseReply = false;
      throw new Error("lost reply");
    }
    return result;
  }).session;
  await value.sync();
  value.edit("abc!");
  loseReply = true;
  expect(await value.sync()).toBe(false);
  expect(value.hasPendingChanges).toBe(true);
  await value.sync();
  expect(value.text).toBe("abc!");
  expect(remote.doc.getText("source").toString()).toBe("abc!");
  value.stop();
  remote.doc.destroy();
});
it("flushes edits typed while an acknowledgement is in flight", async () => {
  const remote = server();
  let release: (() => void) | undefined;
  let delay = false;
  const value = client(async (input) => {
    const reply = await remote.exchange(input);
    if (delay) {
      delay = false;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    return reply;
  }).session;
  await value.sync();
  value.edit("abcX");
  delay = true;
  const pending = value.sync();
  await Promise.resolve();
  await Promise.resolve();
  value.edit("abcXY");
  release?.();
  await pending;
  expect(value.hasPendingChanges).toBe(false);
  expect(remote.doc.getText("source").toString()).toBe("abcXY");
  value.stop();
  remote.doc.destroy();
});
it("preserves the local draft and stops retries after access is revoked or an epoch changes", async () => {
  const remote = server();
  let fail = false;
  let calls = 0;
  const value = client(async (input) => {
    calls++;
    if (fail) throw new CollaborationError("Документ перемещён", 409);
    return remote.exchange(input);
  });
  await value.session.sync();
  value.session.edit("my abc");
  fail = true;
  expect(await value.session.sync()).toBe(false);
  expect(value.session.text).toBe("my abc");
  const previous = calls;
  await value.session.sync();
  expect(calls).toBe(previous);
  expect(value.error).toBeInstanceOf(CollaborationError);
  value.session.stop();
  remote.doc.destroy();
});
it("discards a clean cached epoch when a file changed outside the editor", async () => {
  localStorage.clear();
  const old = server();
  const saved = client(old.exchange, localStorage).session;
  await saved.sync();
  saved.stop();
  const fresh = server();
  fresh.doc.getText("source").delete(0, 3);
  fresh.doc.getText("source").insert(0, "Reverted");
  const resumed = client(async (input) => {
    if (input.epoch) throw new CollaborationError("epoch changed", 409);
    return { ...(await fresh.exchange(input)), epoch: "new-epoch" };
  }, localStorage).session;
  expect(await resumed.sync()).toBe(true);
  expect(resumed.text).toBe("Reverted");
  resumed.stop();
  old.doc.destroy();
  fresh.doc.destroy();
  localStorage.clear();
});
it("does not suppress text recovery for a corrupt shared snapshot", async () => {
  const { hasSharedDraft } = await import("./collaborative-document");
  sessionStorage.clear();
  sessionStorage.setItem(
    "document",
    JSON.stringify({ epoch: "old", state: "broken", vector: "broken" }),
  );
  expect(hasSharedDraft(sessionStorage, "document")).toBe(false);
  const remote = server();
  const saved = client(remote.exchange, sessionStorage).session;
  await saved.sync();
  expect(hasSharedDraft(sessionStorage, "document")).toBe(true);
  saved.stop();
  remote.doc.destroy();
  sessionStorage.clear();
});
