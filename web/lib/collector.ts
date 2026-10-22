import "server-only";
import { collectorBaseUrl, collectorReadKey } from "./env";

export class CollectorRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "CollectorRequestError";
    this.status = status;
  }
}

export async function collectorGet(path: string, query: Record<string, string> = {}): Promise<unknown> {
  const apiKey = await collectorReadKey();
  if (apiKey === undefined) {
    throw new CollectorRequestError(500, "COLLECTOR_READ_KEY не задано. Ключ лишається на сервері Next.js і не вводиться у форму.");
  }

  const base = await parseBaseUrl(await collectorBaseUrl());
  const url = new URL(path.replace(/^\//, ""), base.endsWith("/") ? base : `${base}/`);
  for (const [name, value] of Object.entries(query)) {
    if (value.length > 0) url.searchParams.set(name, value);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json", "X-API-Key": apiKey },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new CollectorRequestError(
      timedOut ? 504 : 502,
      timedOut ? "Collector не відповів вчасно" : `Немає з'єднання з Collector (${base})`,
    );
  }

  if (response.status >= 300 && response.status < 400) {
    throw new CollectorRequestError(502, "Collector перенаправив запит читання. Перенаправлення не виконуються, щоб не віддати ключ.");
  }

  if (!response.ok) {
    throw new CollectorRequestError(response.status, await errorMessage(response));
  }

  try {
    return await response.json() as unknown;
  } catch {
    throw new CollectorRequestError(502, "Collector повернув не JSON");
  }
}

async function parseBaseUrl(value: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CollectorRequestError(500, "COLLECTOR_BASE_URL не є коректним URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CollectorRequestError(500, "COLLECTOR_BASE_URL має бути http або https");
  }
  return url.toString();
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") {
      return `Collector відповів ${response.status}: ${body.error}`;
    }
  } catch {
    // The body is not the JSON error shape.
  }
  return `Collector відповів ${response.status}`;
}
