export interface Filters {
  repo?: string;
  branch?: string;
  from?: string;
  to?: string;
  key?: string;
  cursor?: string;
  limit: string;
}

export interface SearchParams {
  repo?: string | string[];
  branch?: string | string[];
  from?: string | string[];
  to?: string | string[];
  key?: string | string[];
  cursor?: string | string[];
  limit?: string | string[];
}

const MAX_INT = Number.MAX_SAFE_INTEGER;

export function readSearchFilters(params: SearchParams): { filters: Filters; error: string | null; query: Record<string, string> } {
  const repo = pick(params.repo);
  const branch = pick(params.branch);
  const from = pick(params.from);
  const to = pick(params.to);
  const key = pick(params.key);
  const cursor = pick(params.cursor);
  const limitRaw = pick(params.limit);
  const filters: Filters = {
    repo,
    branch,
    from,
    to,
    key,
    cursor,
    limit: limitRaw ?? "100",
  };

  const error = checkInt(from, "from", 0, MAX_INT)
    ?? checkInt(to, "to", 0, MAX_INT)
    ?? checkInt(cursor, "cursor", 0, MAX_INT)
    ?? checkInt(limitRaw, "limit", 1, 1000)
    ?? (from !== undefined && to !== undefined && Number(from) > Number(to) ? "from більший за to" : null);

  const query: Record<string, string> = {};
  if (error === null) {
    if (repo !== undefined) query.repo = repo;
    if (branch !== undefined) query.branch = branch;
    if (from !== undefined) query.from = from;
    if (to !== undefined) query.to = to;
    if (key !== undefined) query.key = key;
    if (cursor !== undefined) query.cursor = cursor;
    query.limit = filters.limit;
  }

  return { filters, error, query };
}

export function toHref(pathname: string, filters: Filters, cursor?: string): string {
  const params = new URLSearchParams();
  if (filters.repo !== undefined) params.set("repo", filters.repo);
  if (filters.branch !== undefined) params.set("branch", filters.branch);
  if (filters.from !== undefined) params.set("from", filters.from);
  if (filters.to !== undefined) params.set("to", filters.to);
  if (filters.key !== undefined) params.set("key", filters.key);
  params.set("limit", filters.limit);
  if (cursor !== undefined && cursor.length > 0) params.set("cursor", cursor);
  const query = params.toString();
  return query.length > 0 ? `${pathname}?${query}` : pathname;
}

export function filtersKey(filters: Filters): string {
  return [filters.repo, filters.branch, filters.from, filters.to, filters.key, filters.cursor, filters.limit].join("\n");
}

function pick(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  return raw;
}

function checkInt(value: string | undefined, name: string, min: number, max: number): string | null {
  if (value === undefined) return null;
  if (!/^\d+$/.test(value)) return `${name} має бути невід'ємним цілим`;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    return `${name} має бути в межах від ${min} до ${max}`;
  }
  return null;
}
