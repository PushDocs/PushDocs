type ProjectChangesParams = { branch?: string; resolve?: string; conflict?: string };

export function projectChangesHref(projectId: string, params: string | ProjectChangesParams = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(
    typeof params === "string" ? { branch: params } : params,
  ))
    if (value !== undefined) query.set(key, value);
  const search = query.toString();
  return `/projects/${projectId}/changes${search ? `?${search}` : ""}`;
}
