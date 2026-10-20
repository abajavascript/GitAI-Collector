import type { FastifyInstance } from "fastify";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Comma-separated or repeated query values, in request order. */
export function queryList(query: unknown, key: string): string[] {
  if (!isRecord(query)) return [];
  const value = query[key];
  const items = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const parts: string[] = [];
  for (const item of items) {
    if (typeof item !== "string") continue;
    for (const part of item.split(",")) {
      const trimmed = part.trim();
      if (trimmed.length > 0) parts.push(trimmed);
    }
  }
  return parts;
}

/**
 * Fastify parse failures stay `{ error }` and never include a success payload.
 * A 500 here is an unexpected failure of the request itself, same as a store throw.
 */
export function setClientErrorHandler(
  scope: FastifyInstance,
  logMessage: string,
  storeFailure: string,
): void {
  scope.setErrorHandler((error, request, reply) => {
    const statusCode = clientStatusCode(error);
    if (statusCode >= 500) {
      request.log.error({ err: error }, logMessage);
      return reply.code(500).send({ error: storeFailure });
    }
    return reply.code(statusCode).send({ error: "invalid request body" });
  });
}

function clientStatusCode(error: unknown): number {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) return 500;
  const statusCode = error.statusCode;
  if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 600) return statusCode;
  return 500;
}
