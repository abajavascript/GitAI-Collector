import type { Metadata } from "next";
import { Clip, JsonBlock, MetadataList, Text } from "../../../components/cells";
import { DataTable } from "../../../components/data-table";
import { FilterForm } from "../../../components/filter-form";
import { Pager, RowCount } from "../../../components/pager";
import { filtersKey, type SearchParams } from "../../../lib/filters";
import { isPage, isPromptItem } from "../../../lib/guards";
import { loadPage } from "../../../lib/load";
import type { PromptItem } from "../../../lib/types";

export const metadata: Metadata = { title: "Prompts" };

const PATH = "/prompts";

export default async function PromptsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const result = await loadPage(`/api/v1${PATH}`, searchParams, (value): value is { items: PromptItem[]; cursor: number | null } => isPage(value, isPromptItem));
  return (
    <>
      <h1>Prompts</h1>
      <p className="banner" role="note">
        Це чутливий вміст CAS: текст промптів не показується на екрані доступу і не входить у таблиці token usage, metrics чи notes.
      </p>
      <p className="lede">
        <code>GET /api/v1/prompts</code>. repo і branch беруться з metadata upload, якщо вони були рядками.
        from і to для цього маршруту не застосовуються.
      </p>
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
  { header: "id", cell: (row: PromptItem) => <Text value={row.id} /> },
  { header: "hash", cell: (row: PromptItem) => <span className="mono">{row.hash}</span> },
  { header: "credential_id", cell: (row: PromptItem) => <Text value={row.credential_id} /> },
  { header: "repo_key", cell: (row: PromptItem) => <Clip value={row.repo_key} title={row.repo_url} /> },
  { header: "branch", cell: (row: PromptItem) => <Text value={row.branch} /> },
  { header: "metadata", cell: (row: PromptItem) => <MetadataList metadata={row.metadata} /> },
  { header: "content", cell: (row: PromptItem) => <JsonBlock label="вміст" value={row.content} /> },
];
