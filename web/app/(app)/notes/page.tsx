import type { Metadata } from "next";
import { JsonBlock, Text } from "../../../components/cells";
import { DataTable } from "../../../components/data-table";
import { FilterForm } from "../../../components/filter-form";
import { Pager, RowCount } from "../../../components/pager";
import { filtersKey, type SearchParams } from "../../../lib/filters";
import { isNoteItem, isPage } from "../../../lib/guards";
import { loadPage } from "../../../lib/load";
import type { NoteItem } from "../../../lib/types";

export const metadata: Metadata = { title: "Notes" };

const PATH = "/notes";

export default async function NotesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const result = await loadPage(`/api/v1${PATH}`, searchParams, (value): value is { items: NoteItem[]; cursor: number | null } => isPage(value, isNoteItem));
  return (
    <>
      <h1>Notes</h1>
      <p className="lede"><code>GET /api/v1/notes</code>. У протоколі upload немає repo, branch і часу, тож ці фільтри таблицю не звужують. Працюють key, cursor і limit.</p>
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
  { header: "id", cell: (row: NoteItem) => <Text value={row.id} /> },
  { header: "credential_id", cell: (row: NoteItem) => <Text value={row.credential_id} /> },
  { header: "commit_sha", cell: (row: NoteItem) => <span className="mono">{row.commit_sha}</span> },
  { header: "content", cell: (row: NoteItem) => <JsonBlock label="текст" value={row.content} /> },
];
