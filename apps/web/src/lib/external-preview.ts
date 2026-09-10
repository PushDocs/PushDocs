const reviewNumberPlaceholder = /\{(?:REVIEW|MR|PR)_NUMBER\}/g;

export function externalPreviewUrl(template: string | undefined, reviewNumber: string) {
  const value = template?.trim();
  if (!value || !reviewNumberPlaceholder.test(value)) return;
  reviewNumberPlaceholder.lastIndex = 0;
  try {
    const url = new URL(value.replace(reviewNumberPlaceholder, encodeURIComponent(reviewNumber)));
    if (url.protocol !== "https:" && url.protocol !== "http:") return;
    return url.toString();
  } catch {
    return;
  }
}
