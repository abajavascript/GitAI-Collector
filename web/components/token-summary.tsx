import { formatCount, formatUsd, sumNumbers } from "../lib/format";
import type { TokenUsageItem } from "../lib/types";

export function TokenSummary({ items, limit }: { items: readonly TokenUsageItem[]; limit: string }) {
  const input = sumNumbers(items.map((item) => item.input_tokens));
  const output = sumNumbers(items.map((item) => item.output_tokens));
  const total = sumNumbers(items.map((item) => item.total_tokens));
  const cost = sumNumbers(items.map((item) => item.est_cost_micro_usd));
  const full = Number.isFinite(Number(limit)) && items.length >= Number(limit);

  return (
    <section aria-label="Підсумок завантаженої сторінки">
      <p className="hint">
        Підсумок пораховано лише з рядків цієї відповіді. Це не сума за місяць і не зріз за весь період:
        один запит віддає не більше 1000 рядків. Агрегати Collector тут не рахуються.
        Оціночна вартість взята з est_cost_micro_usd і не є фактичними фінансовими витратами.
      </p>
      <div className="summary">
        <Figure label="Рядків на сторінці" value={formatCount(items.length)} missing={0} />
        <Figure label="input_tokens" value={formatCount(input.sum)} missing={input.missing} />
        <Figure label="output_tokens" value={formatCount(output.sum)} missing={output.missing} />
        <Figure label="total_tokens" value={formatCount(total.sum)} missing={total.missing} />
        <Figure label="оціночна вартість" value={formatUsd(cost.sum)} missing={cost.missing} />
      </div>
      {full ? <p className="hint">Сторінка заповнена до limit. Наступні рядки в цю суму не входять.</p> : null}
    </section>
  );
}

function Figure({ label, value, missing }: { label: string; value: string; missing: number }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
      {missing > 0 ? <small>рядків без значення, не в сумі: {missing}</small> : null}
    </div>
  );
}
