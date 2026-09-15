import * as Y from "yjs";

export interface DocumentExchange {
  projectId: string;
  branch: string;
  path: string;
  userId: string;
  epoch?: string;
  update?: string;
  vector?: string;
}
export interface DocumentExchangeResult {
  epoch: string;
  update: string;
  vector: string;
  content: string;
  revision: number;
  changeSetId?: string;
}

export function decodeDocumentUpdate(value: string): Uint8Array {
  if (
    value.length > 8_000_000 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  )
    throw new Error("Некорректные операции документа");
  return Buffer.from(value, "base64");
}
export function encodeDocumentUpdate(value: Uint8Array): string {
  return Buffer.from(value).toString("base64");
}
export function openSharedDocument(content: string, update?: string): Y.Doc {
  const doc = new Y.Doc();
  if (update) Y.applyUpdate(doc, decodeDocumentUpdate(update));
  else doc.getText("source").insert(0, content);
  return doc;
}
