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
  const splitAt = formatted.iso.indexOf("T");
  const date = splitAt === -1 ? formatted.iso : formatted.iso.slice(0, splitAt);
  const time = splitAt === -1 ? "" : formatted.iso.slice(splitAt + 1);
  return (
    <time className="mono timestamp" dateTime={formatted.iso} title={String(value)}>
      <span>{date}</span>
      {time.length > 0 ? <span>{time}</span> : null}
    </time>
  );
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
