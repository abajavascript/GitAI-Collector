import type { Metadata } from "next";
import { Clip, Cost, JsonBlock, Text, Timestamp } from "../../../components/cells";
import { DataTable } from "../../../components/data-table";
import { FilterForm } from "../../../components/filter-form";
import { Pager } from "../../../components/pager";
import { TokenSummary } from "../../../components/token-summary";
import { filtersKey, type SearchParams } from "../../../lib/filters";
import { isPage, isTokenUsageItem } from "../../../lib/guards";
import { loadPage } from "../../../lib/load";
import type { TokenUsageItem } from "../../../lib/types";

export const metadata: Metadata = { title: "Token usage" };

const PATH = "/token-usage";

export default async function TokenUsagePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const result = await loadPage(`/api/v1${PATH}`, searchParams, (value): value is { items: TokenUsageItem[]; cursor: number | null } => isPage(value, isTokenUsageItem));
  return (
    <>
      <h1>Token usage</h1>
      <p className="lede"><code>GET /api/v1/token-usage</code>. from і to порівнюються з bucket_ts.</p>
      <FilterForm key={filtersKey(result.filters)} pathname={PATH} filters={result.filters} />
      {result.error !== null ? <p className="error" role="alert">{result.error}</p> : null}
      {result.data !== null ? (
        <>
          <TokenSummary items={result.data.items} limit={result.filters.limit} />
          <DataTable columns={columns} rows={result.data.items} />
          <Pager pathname={PATH} filters={result.filters} count={result.data.items.length} nextCursor={result.data.cursor} />
        </>
      ) : null}
    </>
  );
}

const columns = [
  { header: "id", cell: (row: TokenUsageItem) => <Text value={row.id} /> },
  { header: "bucket_ts", cell: (row: TokenUsageItem) => <Timestamp value={row.bucket_ts} /> },
  { header: "credential_id", cell: (row: TokenUsageItem) => <Text value={row.credential_id} /> },
  { header: "repo_key", cell: (row: TokenUsageItem) => <Clip value={row.repo_key} title={row.repo_url} /> },
  { header: "branch", cell: (row: TokenUsageItem) => <Text value={row.branch} /> },
  { header: "author", cell: (row: TokenUsageItem) => <Clip value={row.author} /> },
  { header: "model", cell: (row: TokenUsageItem) => <Text value={row.model} /> },
  { header: "tool", cell: (row: TokenUsageItem) => <Text value={row.tool} /> },
  { header: "session", cell: (row: TokenUsageItem) => <Clip value={row.session} /> },
  { header: "input_tokens", cell: (row: TokenUsageItem) => <Text value={row.input_tokens} /> },
  { header: "output_tokens", cell: (row: TokenUsageItem) => <Text value={row.output_tokens} /> },
  { header: "total_tokens", cell: (row: TokenUsageItem) => <Text value={row.total_tokens} /> },
  { header: "est_cost_micro_usd", cell: (row: TokenUsageItem) => <Cost micro={row.est_cost_micro_usd} /> },
  { header: "raw", cell: (row: TokenUsageItem) => <JsonBlock label="raw" value={row.raw} /> },
];
