import "server-only";
import { CollectorRequestError, collectorGet } from "./collector";
import { readSearchFilters, type Filters, type SearchParams } from "./filters";

export interface LoadResult<T> {
  filters: Filters;
  data: T | null;
  error: string | null;
}

export async function loadPage<T>(
  path: string,
  searchParams: Promise<SearchParams>,
  guard: (value: unknown) => value is T,
): Promise<LoadResult<T>> {
  const { filters, error, query } = readSearchFilters(await searchParams);
  if (error !== null) return { filters, data: null, error };
  try {
    const payload = await collectorGet(path, query);
    if (!guard(payload)) {
      return { filters, data: null, error: "Collector повернув неочікувану відповідь" };
    }
    return { filters, data: payload, error: null };
  } catch (caught) {
    const message = caught instanceof CollectorRequestError ? caught.message : "Не вдалося прочитати Collector";
    return { filters, data: null, error: message };
  }
}
