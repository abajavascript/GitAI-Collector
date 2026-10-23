import type { ReactNode } from "react";
import type { MetricItem } from "../lib/types";
import { JsonBlock, Text, Timestamp } from "./cells";

const COLUMNS = 6;

export function MetricsTable({ rows }: { rows: readonly MetricItem[] }) {
  if (rows.length === 0) return <p className="empty">Немає рядків для цих фільтрів.</p>;
  return (
    <div className="table-wrap">
      <table className="metrics-table">
        <colgroup>
          <col />
          <col />
          <col />
          <col />
          <col />
          <col />
        </colgroup>
        {rows.map((row) => (
          <tbody key={row.id}>
            <tr>
              <Field label="id"><Text value={row.id} /></Field>
              <Field label="timestamp"><Timestamp value={row.timestamp} /></Field>
              <Field label="event"><Text value={row.event} /></Field>
              <Field label="credential_id"><Text value={row.credential_id} /></Field>
              <Field label="repo_key"><Mono value={row.repo_key} title={row.repo_url} /></Field>
              <Field label="branch"><Text value={row.branch} /></Field>
            </tr>
            <tr>
              <Field label="author"><Wrapped value={row.author} /></Field>
              <Field label="commit_sha" span={2}><Mono value={row.commit_sha} /></Field>
              <Field label="tool"><Text value={row.tool} /></Field>
              <Field label="model"><Text value={row.model} /></Field>
              <Field label="session"><Mono value={row.session} /></Field>
            </tr>
            <tr className="raw-row">
              <td colSpan={COLUMNS}>
                <JsonBlock label="raw" value={row.raw} />
              </td>
            </tr>
          </tbody>
        ))}
      </table>
    </div>
  );
}

function Field({ label, span = 1, children }: { label: string; span?: number; children: ReactNode }) {
  return (
    <td colSpan={span > 1 ? span : undefined}>
      <span className="field-label">{label}</span>
      {children}
    </td>
  );
}

function Mono({ value, title }: { value: string | null; title?: string | null }) {
  if (value === null || value.length === 0) return <span className="muted">—</span>;
  return <span className="mono wrap-value" title={title ?? value}>{value}</span>;
}

function Wrapped({ value }: { value: string | null }) {
  if (value === null || value.length === 0) return <span className="muted">—</span>;
  return <span className="wrap-value" title={value}>{value}</span>;
}
