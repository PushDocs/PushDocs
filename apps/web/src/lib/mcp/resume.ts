export const oauthResumeCookie = "pushdocs_oauth_resume";
export function oauthResumeTarget(value?: string) {
  if (!value || value.length > 3500 || !value.startsWith("/oauth/authorize?")) return "/projects";
  return value;
}
