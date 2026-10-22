const PREVIEW_LIMIT = 50_000;

const tokens = new Intl.NumberFormat("uk-UA");
const usd = new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 6 });

export function formatCount(value: number): string {
  return tokens.format(value);
}

export function formatUsd(microUsd: number): string {
  return `${usd.format(microUsd / 1_000_000)} USD`;
}

export function formatUnixSeconds(value: number): { iso: string | null; label: string } {
  if (!Number.isFinite(value)) return { iso: null, label: String(value) };
  const date = new Date(value * 1000);
  const year = date.getUTCFullYear();
  if (Number.isNaN(date.getTime()) || year < 2000 || year > 2100) return { iso: null, label: String(value) };
  const iso = date.toISOString().replace(".000Z", "Z");
  return { iso, label: iso };
}

export function formatJson(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return "[unserializable]";
  }
}

export function previewText(value: string): { text: string; truncated: boolean } {
  if (value.length <= PREVIEW_LIMIT) return { text: value, truncated: false };
  return { text: value.slice(0, PREVIEW_LIMIT), truncated: true };
}

export function sumNumbers(values: readonly (number | null)[]): { sum: number; missing: number } {
  let sum = 0;
  let missing = 0;
  for (const value of values) {
    if (typeof value !== "number") missing += 1;
    else sum += value;
  }
  return { sum, missing };
}
