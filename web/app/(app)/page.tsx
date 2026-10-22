import type { Metadata } from "next";
import Link from "next/link";
import { CollectorRequestError, collectorGet } from "../../lib/collector";
import { isAccess } from "../../lib/guards";
import type { AccessResponse } from "../../lib/types";

export const metadata: Metadata = { title: "Доступ" };

export default async function AccessPage() {
  const loaded = await loadAccess();
  return (
    <>
      <h1>Доступ ключа</h1>
      <p className="lede">
        <code>GET /api/v1/access</code>. Браузер не викликає Collector і не бачить ключ.
        Це сигнали використання, не оцінка продуктивності і не довідник співробітників.
      </p>
      {loaded.error !== null ? <p className="error" role="alert">{loaded.error}</p> : null}
      {loaded.access !== null ? <AccessTable access={loaded.access} /> : null}
      <h2>Таблиці</h2>
      <ul className="toc">
        <li><Link href="/token-usage" prefetch={false}>Token usage</Link> — токени й оціночна вартість, сума лише завантаженої сторінки</li>
        <li><Link href="/metrics" prefetch={false}>Metrics</Link> — події</li>
        <li><Link href="/notes" prefetch={false}>Notes</Link> — commit і текст нотатки</li>
        <li><Link href="/prompts" prefetch={false}>Prompts</Link> — окремий екран, чутливий вміст CAS</li>
      </ul>
    </>
  );
}

function AccessTable({ access }: { access: AccessResponse }) {
  return (
    <div className="table-wrap">
      <table>
        <tbody>
          <tr>
            <th scope="row">id</th>
            <td><code>{access.id}</code></td>
          </tr>
          <tr>
            <th scope="row">read</th>
            <td>{formatRead(access.read)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function formatRead(read: AccessResponse["read"]): string {
  if (read === "*") return "* (усі credential id, включно з рядками без credential_id)";
  if (read.length === 0) return "порожній scope";
  return read.join(", ");
}

async function loadAccess(): Promise<{ access: AccessResponse | null; error: string | null }> {
  try {
    const payload = await collectorGet("/api/v1/access");
    if (!isAccess(payload)) return { access: null, error: "Collector повернув неочікувану відповідь" };
    return { access: payload, error: null };
  } catch (caught) {
    const message = caught instanceof CollectorRequestError ? caught.message : "Не вдалося прочитати Collector";
    return { access: null, error: message };
  }
}
