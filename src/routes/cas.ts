import type { FastifyInstance } from "fastify";

import { CollectorStoreError } from "../store/errors.js";
import type { CasObjectInput } from "../store/types.js";
import { isRecord, queryList, setClientErrorHandler } from "./http.js";

const STORE_FAILURE = "failed to store cas objects";

type CasSlot =
  | { ok: true; object: CasObjectInput }
  | { ok: false; hash: string; error: string };

/**
 * CLI contract for POST /worker/cas/upload and GET /worker/cas/?hashes=.
 * Wire status is "ok" or "error". An existing hash is "ok" and the first
 * object is kept. A read that matches nothing is 404, which the CLI treats
 * as an empty result.
 */
export function registerCasRoutes(app: FastifyInstance): void {
  app.register(async (scope) => {
    setClientErrorHandler(scope, "cas request failed", STORE_FAILURE);

    scope.post("/worker/cas/upload", async (request, reply) => {
      const parsed = readCasUpload(request.body);
      if (!parsed.ok) return reply.code(400).send({ error: parsed.error });

      const objects: CasObjectInput[] = [];
      for (const slot of parsed.slots) {
        if (slot.ok) objects.push(slot.object);
      }

      try {
        const written = await app.store.putCasObjects(request.identity, objects);
        const results: { hash: string; status: "ok" | "error"; error?: string }[] = [];
        let successCount = 0;
        let failureCount = 0;
        let storeIndex = 0;
        for (const slot of parsed.slots) {
          if (!slot.ok) {
            failureCount += 1;
            results.push({ hash: slot.hash, status: "error", error: slot.error });
            continue;
          }
          const item = written.results[storeIndex];
          storeIndex += 1;
          if (item === undefined) throw new Error("cas write result missing");
          if (item.status === "error") {
            failureCount += 1;
            results.push({ hash: item.hash, status: "error", error: item.error ?? "cas object rejected" });
            continue;
          }
          successCount += 1;
          results.push({ hash: item.hash, status: "ok" });
        }
        return { results, success_count: successCount, failure_count: failureCount };
      } catch (error) {
        if (error instanceof CollectorStoreError) {
          return reply.code(400).send({ error: error.message });
        }
        request.log.error({ err: error }, "cas upload failed");
        return reply.code(500).send({ error: STORE_FAILURE });
      }
    });

    scope.get("/worker/cas", async (request, reply) => {
      if (request.credential === null || (Array.isArray(request.credential.read) && request.credential.read.length === 0)) {
        return reply.code(403).send({ error: "read access denied" });
      }
      const hashes = queryList(request.query, "hashes");
      const found = await app.store.getCasObjects(hashes, request.credential.read);
      const byHash = new Map(found.map((object) => [object.hash, object]));
      const results: { hash: string; status: "ok" | "error"; content?: unknown; error?: string }[] = [];
      let successCount = 0;
      for (const hash of hashes) {
        const object = byHash.get(hash);
        if (object === undefined) {
          results.push({ hash, status: "error", error: "not found" });
          continue;
        }
        successCount += 1;
        results.push({ hash, status: "ok", content: object.content });
      }
      if (successCount === 0) {
        return reply.code(404).send({
          results: [],
          success_count: 0,
          failure_count: hashes.length,
        });
      }
      return {
        results,
        success_count: successCount,
        failure_count: hashes.length - successCount,
      };
    });
  });
}

function readCasUpload(body: unknown): { ok: true; slots: CasSlot[] } | { ok: false; error: string } {
  if (!isRecord(body)) return { ok: false, error: "invalid request body" };
  if (!Array.isArray(body.objects)) return { ok: false, error: "cas objects must be an array" };
  return { ok: true, slots: body.objects.map(readCasObject) };
}

function readCasObject(value: unknown): CasSlot {
  if (!isRecord(value)) return { ok: false, hash: "", error: "cas object must be an object" };
  const hash = typeof value.hash === "string" ? value.hash : "";
  if (!Object.hasOwn(value, "content")) {
    return { ok: false, hash, error: "cas object is missing content" };
  }
  const metadata = readMetadata(value.metadata);
  if (!metadata.ok) return { ok: false, hash, error: metadata.error };
  return { ok: true, object: { hash, content: value.content, metadata: metadata.value } };
}

function readMetadata(
  value: unknown,
): { ok: true; value: Record<string, string> } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: {} };
  if (!isRecord(value)) return { ok: false, error: "cas metadata must be an object" };
  const metadata: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") return { ok: false, error: "cas metadata values must be strings" };
    metadata[key] = item;
  }
  return { ok: true, value: metadata };
}
