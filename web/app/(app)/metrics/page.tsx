import type { Metadata } from "next";
import { FilterForm } from "../../../components/filter-form";
import { MetricsTable } from "../../../components/metrics-table";
import { Pager, RowCount } from "../../../components/pager";
import { filtersKey, type SearchParams } from "../../../lib/filters";
import { isMetricItem, isPage } from "../../../lib/guards";
import { loadPage } from "../../../lib/load";
import type { MetricItem } from "../../../lib/types";

export const metadata: Metadata = { title: "Metrics" };

const PATH = "/metrics";

export default async function MetricsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const result = await loadPage(`/api/v1${PATH}`, searchParams, (value): value is { items: MetricItem[]; cursor: number | null } => isPage(value, isMetricItem));
  return (
    <>
      <h1>Metrics</h1>
      <p className="lede"><code>GET /api/v1/metrics</code>. from і to порівнюються з timestamp події.</p>
      <FilterForm key={filtersKey(result.filters)} pathname={PATH} filters={result.filters} />
      {result.error !== null ? <p className="error" role="alert">{result.error}</p> : null}
      {result.data !== null ? (
        <>
          <RowCount count={result.data.items.length} limit={result.filters.limit} />
          <MetricsTable rows={result.data.items} />
          <Pager pathname={PATH} filters={result.filters} count={result.data.items.length} nextCursor={result.data.cursor} />
        </>
      ) : null}
    </>
  );
}
