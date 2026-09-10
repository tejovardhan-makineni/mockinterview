// Limit return destinations to this app, including browsers that normalize backslashes.
export function localDestination(
  value: string | null,
  fallback = "/interviews",
): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u001f]/.test(value)
  )
    return fallback;
  return value;
}
export function policyDestination(next: string): string {
  return "/consent?next=" + encodeURIComponent(localDestination(next));
}
