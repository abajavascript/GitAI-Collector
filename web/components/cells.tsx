import { formatJson, formatUnixSeconds, formatUsd, previewText } from "../lib/format";

export function Text({ value }: { value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === "") return <span className="muted">—</span>;
  return <>{value}</>;
}

export function Clip({ value, title }: { value: string | null; title?: string | null }) {
  if (value === null || value.length === 0) return <span className="muted">—</span>;
  return <span className="clip mono" title={title ?? value}>{value}</span>;
}

export function Timestamp({ value }: { value: number }) {
  const formatted = formatUnixSeconds(value);
  if (formatted.iso === null) return <span className="mono" title={String(value)}>{formatted.label}</span>;
  return <time className="mono" dateTime={formatted.iso} title={String(value)}>{formatted.label}</time>;
}

export function Cost({ micro }: { micro: number | null }) {
  if (micro === null) return <span className="muted">—</span>;
  return <span title={`${micro} micro-USD`}>{formatUsd(micro)}</span>;
}

export function JsonBlock({ label, value }: { label: string; value: unknown }) {
  const preview = previewText(formatJson(value));
  return (
    <details>
      <summary>{label}</summary>
      <pre className="payload">{preview.text}</pre>
      {preview.truncated ? <p className="hint">Показано початок. Повне значення лишається в Collector.</p> : null}
    </details>
  );
}

export function MetadataList({ metadata }: { metadata: Record<string, string> }) {
  const entries = Object.entries(metadata);
  if (entries.length === 0) return <span className="muted">—</span>;
  return (
    <dl className="meta">
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
