export function projectChangesHref(projectId: string, branch: string) {
  return `/projects/${projectId}/changes?${new URLSearchParams({ branch })}`;
}
