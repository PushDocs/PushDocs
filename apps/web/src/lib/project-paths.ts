export type ChangesLocation = { path?: string; line?: string; search?: string };
export function projectChangesApiPath(projectId: string) {
  return `/api/projects/${projectId}/changes`;
}

export function parseLineNumber(value?: string) {
  const line = Number(value);
  return Number.isSafeInteger(line) && line > 0 ? line : undefined;
}
type ProjectChangesParams = ChangesLocation & {
  branch?: string;
  resolve?: string;
  conflict?: string;
};

export function projectDocumentLineHref(
  projectId: string,
  branch: string,
  path: string,
  line: number,
  search?: string,
) {
  const query = new URLSearchParams({ branch, path, line: String(line), from: "changes" });
  if (search) query.set("search", search);
  return `/projects/${projectId}/documents?${query}`;
}

export function projectChangesHref(projectId: string, params: string | ProjectChangesParams = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(
    typeof params === "string" ? { branch: params } : params,
  ))
    if (value !== undefined) query.set(key, value);
  const search = query.toString();
  return `/projects/${projectId}/changes${search ? `?${search}` : ""}`;
}
