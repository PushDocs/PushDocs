export interface LocalDraft {
  text: string;
  base: string;
}
export const draftKey = (project: string, branch: string, path: string, owner = "session") =>
  `pushdocs:draft:${JSON.stringify([owner, project, branch, path])}`;
export function readDraft(key: string): LocalDraft | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    if (typeof value?.text === "string" && typeof value?.base === "string") return value;
  } catch {
    /* Storage may be disabled or corrupted. */
  }
}
export function writeDraft(key: string, text: string, base: string): boolean {
  try {
    localStorage.setItem(key, JSON.stringify({ text, base }));
    return true;
  } catch {
    return false;
  }
}
export function clearDraft(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* Optional storage. */
  }
}
export class WorkbenchRequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
