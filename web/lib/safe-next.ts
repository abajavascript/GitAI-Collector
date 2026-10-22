/** Keep post-login redirects on this app, including query values such as repo URLs. */
export function safeNext(value: string): string {
  if (value.length === 0 || value.length > 2048) return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  const path = value.split(/[?#]/, 1)[0] ?? "/";
  if (path.length === 0 || path.includes(":") || path.startsWith("/login")) return "/";
  return value;
}
