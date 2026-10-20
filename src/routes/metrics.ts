import type { FastifyInstance } from "fastify";

import { CollectorStoreError } from "../store/errors.js";
import type { MetricsBatchInput } from "../store/types.js";

const STORE_FAILURE = "failed to store metrics";

/**
 * CLI contract for POST /worker/metrics/upload.
 * Per-event validation problems are 200 `{ errors }` so a bad event can be
 * reported without discarding its siblings. An empty `errors` array means the
 * batch was accepted, including exact replays and older token-usage revisions.
 * A database failure is 500 with no `errors` array: the CLI retries any
 * non-empty `errors` list, and a partial 200 would describe rows the
 * transaction rolled back.
 */
export function registerMetricsRoute(app: FastifyInstance): void {
  app.register(async (scope) => {
    scope.setErrorHandler((error, request, reply) => {
      const statusCode = clientStatusCode(error);
      if (statusCode >= 500) {
        request.log.error({ err: error }, "metrics upload failed");
        return reply.code(500).send({ error: STORE_FAILURE });
      }
      return reply.code(statusCode).send({ error: "invalid request body" });
    });

    scope.post("/worker/metrics/upload", async (request, reply) => {
      const batch = readMetricsBatch(request.body);
      if (!batch.ok) return reply.code(400).send({ error: batch.error });

      try {
        const written = await app.store.writeMetrics(request.identity, batch.batch);
        const errors: { index: number; error: string }[] = [];
        for (const result of written.results) {
          if (result.status !== "error") continue;
          errors.push({ index: result.index, error: result.error ?? "invalid metric event" });
        }
        return { errors };
      } catch (error) {
        if (error instanceof CollectorStoreError) {
          return reply.code(400).send({ error: error.message });
        }
        request.log.error({ err: error }, "metrics upload failed");
        return reply.code(500).send({ error: STORE_FAILURE });
      }
    });
  });
}

function readMetricsBatch(
  body: unknown,
): { ok: true; batch: MetricsBatchInput } | { ok: false; error: string } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "invalid request body" };
  }
  const record = body as Record<string, unknown>;
  if (typeof record.v !== "number" || !Number.isSafeInteger(record.v) || record.v < 0) {
    return { ok: false, error: "metrics version must be an integer" };
  }
  if (!Array.isArray(record.events)) {
    return { ok: false, error: "metrics events must be an array" };
  }
  return { ok: true, batch: { version: record.v, events: record.events } };
}

function clientStatusCode(error: unknown): number {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) return 500;
  const statusCode = error.statusCode;
  if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 600) return statusCode;
  return 500;
}
