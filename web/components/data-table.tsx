import type { ReactNode } from "react";

export function DataTable<T extends { id: number }>({
  columns,
  rows,
}: {
  columns: readonly { header: string; cell: (row: T) => ReactNode }[];
  rows: readonly T[];
}) {
  if (rows.length === 0) return <p className="empty">Немає рядків для цих фільтрів.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.header} scope="col">{column.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((column) => (
                <td key={column.header}>{column.cell(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
