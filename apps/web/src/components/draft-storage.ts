export interface LocalDraft {
  text: string;
  base: string;
}
const localDraftPrefix = "pushdocs:draft:";
export const draftKey = (project: string, branch: string, path: string, owner = "session") =>
  `${localDraftPrefix}${JSON.stringify([owner, project, branch, path])}`;
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

export function listLocalDrafts(project: string, branches: string[], owner: string) {
  const drafts: Array<{ branch: string; path: string }> = [];
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(localDraftPrefix)) continue;
      try {
        const [draftOwner, draftProject, branch, path] = JSON.parse(
          key.slice(localDraftPrefix.length),
        );
        const draft = readDraft(key);
        if (
          draftOwner === owner &&
          draftProject === project &&
          branches.includes(branch) &&
          typeof path === "string" &&
          draft &&
          draft.text !== draft.base
        )
          drafts.push({ branch, path });
      } catch {
        /* An unrelated or damaged draft must not hide other drafts. */
      }
    }
  } catch {
    /* Optional browser storage. Server drafts are checked independently. */
  }
  return drafts;
}
export class WorkbenchRequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
