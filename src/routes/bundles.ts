import type { FastifyInstance } from "fastify";

import { CollectorStoreError } from "../store/errors.js";
import type { BundleInput } from "../store/types.js";
import { isRecord, setClientErrorHandler } from "./http.js";

const STORE_FAILURE = "failed to store bundle";

/**
 * CLI contract for POST /api/bundles.
 * `url` points at GET /api/bundles/:id, which returns the stored JSON.
 * An HTML page for that URL waits for the UI phase.
 */
export function registerBundleRoutes(app: FastifyInstance): void {
  app.register(async (scope) => {
    setClientErrorHandler(scope, "bundle request failed", STORE_FAILURE);

    scope.post("/api/bundles", async (request, reply) => {
      const parsed = readBundle(request.body);
      if (!parsed.ok) return reply.code(400).send({ error: parsed.error });

      try {
        const record = await app.store.createBundle(request.identity, parsed.bundle);
        return {
          success: true,
          id: record.id,
          url: `${app.config.publicBaseUrl}/api/bundles/${encodeURIComponent(record.id)}`,
        };
      } catch (error) {
        if (error instanceof CollectorStoreError) {
          return reply.code(400).send({ error: error.message });
        }
        request.log.error({ err: error }, "bundle create failed");
        return reply.code(500).send({ error: STORE_FAILURE });
      }
    });

    scope.get("/api/bundles/:id", async (request, reply) => {
      const id = readId(request.params);
      if (id === undefined) return reply.code(404).send({ error: "bundle not found" });
      const record = await app.store.getBundle(id);
      if (record === null) return reply.code(404).send({ error: "bundle not found" });
      return record.body;
    });
  });
}

function readBundle(body: unknown): { ok: true; bundle: BundleInput } | { ok: false; error: string } {
  if (!isRecord(body)) return { ok: false, error: "invalid request body" };
  if (typeof body.title !== "string" || body.title.trim().length === 0) {
    return { ok: false, error: "bundle title is required" };
  }
  if (!isRecord(body.data)) return { ok: false, error: "bundle data is required" };
  if (!isRecord(body.data.prompts)) return { ok: false, error: "bundle prompts are required" };
  if (Object.hasOwn(body.data, "files") && !isRecord(body.data.files)) {
    return { ok: false, error: "bundle files must be an object" };
  }
  return { ok: true, bundle: { title: body.title, data: body.data } };
}

function readId(params: unknown): string | undefined {
  if (!isRecord(params)) return undefined;
  const id = params.id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}
