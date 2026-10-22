import type { Metadata } from "next";
import { Clip, JsonBlock, Text, Timestamp } from "../../../components/cells";
import { DataTable } from "../../../components/data-table";
import { FilterForm } from "../../../components/filter-form";
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
          <DataTable columns={columns} rows={result.data.items} />
          <Pager pathname={PATH} filters={result.filters} count={result.data.items.length} nextCursor={result.data.cursor} />
        </>
      ) : null}
    </>
  );
}

const columns = [
  { header: "id", cell: (row: MetricItem) => <Text value={row.id} /> },
  { header: "timestamp", cell: (row: MetricItem) => <Timestamp value={row.timestamp} /> },
  { header: "event", cell: (row: MetricItem) => <Text value={row.event} /> },
  { header: "credential_id", cell: (row: MetricItem) => <Text value={row.credential_id} /> },
  { header: "repo_key", cell: (row: MetricItem) => <Clip value={row.repo_key} title={row.repo_url} /> },
  { header: "branch", cell: (row: MetricItem) => <Text value={row.branch} /> },
  { header: "author", cell: (row: MetricItem) => <Clip value={row.author} /> },
  { header: "commit_sha", cell: (row: MetricItem) => <Clip value={row.commit_sha} /> },
  { header: "tool", cell: (row: MetricItem) => <Text value={row.tool} /> },
  { header: "model", cell: (row: MetricItem) => <Text value={row.model} /> },
  { header: "session", cell: (row: MetricItem) => <Clip value={row.session} /> },
  { header: "raw", cell: (row: MetricItem) => <JsonBlock label="raw" value={row.raw} /> },
];
