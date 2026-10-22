export function isLocalHostHeader(value: string): boolean {
  return value.split(",").every((part) => isLocalHost(part.trim()));
}

export function hostsAreLocal(headerList: Headers): boolean {
  const values = [headerList.get("host"), headerList.get("x-forwarded-host")].filter(
    (value): value is string => value !== null && value.length > 0,
  );
  return values.length > 0 && values.every((value) => isLocalHostHeader(value));
}

function isLocalHost(hostHeader: string): boolean {
  const host = hostHeader.trim().toLowerCase();
  if (host.length === 0) return false;
  let name = host;
  if (name.startsWith("[")) {
    const end = name.indexOf("]");
    if (end <= 1) return false;
    name = name.slice(1, end);
  } else {
    name = name.replace(/:\d+$/, "");
  }
  return name === "localhost" || name === "127.0.0.1" || name === "::1";
}
