import { toHref, type Filters } from "../lib/filters";

export function Pager({
  pathname,
  filters,
  count,
  nextCursor,
}: {
  pathname: string;
  filters: Filters;
  count: number;
  nextCursor: number | null;
}) {
  const limit = Number(filters.limit);
  const hasMore = nextCursor !== null && Number.isSafeInteger(limit) && count >= limit;
  const onLaterPage = filters.cursor !== undefined;
  if (!hasMore && !onLaterPage) return null;
  return (
    <p className="pager">
      {onLaterPage ? <a href={toHref(pathname, filters)}>На початок</a> : null}
      {hasMore ? <a href={toHref(pathname, filters, String(nextCursor))}>Наступна сторінка</a> : <span className="muted">Більше рядків немає</span>}
    </p>
  );
}

export function RowCount({ count, limit }: { count: number; limit: string }) {
  const full = Number.isFinite(Number(limit)) && count >= Number(limit);
  return (
    <p className="hint">
      Рядків на цій сторінці: {count}.
      {full ? " Сторінка заповнена до limit, тож вибірка може бути неповною." : ""}
    </p>
  );
}
