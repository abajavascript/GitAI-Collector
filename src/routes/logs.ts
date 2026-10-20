import type { FastifyInstance } from "fastify";

import { CollectorStoreError } from "../store/errors.js";
import type { LogBatchInput } from "../store/types.js";
import { isRecord, setClientErrorHandler } from "./http.js";

const STORE_FAILURE = "failed to store logs";

/**
 * CLI contract for POST /worker/logs/upload, protocol version 1.
 * Events are stored in the request, so `enqueued` is false. `accepted` counts
 * new rows, `dropped` counts an event id already stored, and `errors` lists
 * events the batch could not accept. A database failure is 500 with no counts:
 * the CLI treats HTTP 200 as a completed upload.
 */
export function registerLogRoutes(app: FastifyInstance): void {
  app.register(async (scope) => {
    setClientErrorHandler(scope, "logs upload failed", STORE_FAILURE);

    scope.post("/worker/logs/upload", async (request, reply) => {
      const parsed = readLogUpload(request.body);
      if (!parsed.ok) return reply.code(400).send({ error: parsed.error });

      try {
        const written = await app.store.writeLogs(request.identity, parsed.batch);
        return {
          accepted: written.accepted,
          dropped: written.dropped,
          enqueued: false,
          errors: written.errors,
        };
      } catch (error) {
        if (error instanceof CollectorStoreError) {
          return reply.code(400).send({ error: error.message });
        }
        request.log.error({ err: error }, "logs upload failed");
        return reply.code(500).send({ error: STORE_FAILURE });
      }
    });
  });
}

function readLogUpload(body: unknown): { ok: true; batch: LogBatchInput } | { ok: false; error: string } {
  if (!isRecord(body)) return { ok: false, error: "invalid request body" };
  if (typeof body.version !== "number" || !Number.isSafeInteger(body.version) || body.version < 0) {
    return { ok: false, error: "logs version must be an integer" };
  }
  if (!Array.isArray(body.events)) return { ok: false, error: "log events must be an array" };

  const gitAiVersion = readOptionalText(body, "git_ai_version", "logs git_ai_version");
  if (!gitAiVersion.ok) return gitAiVersion;
  const daemonId = readOptionalText(body, "daemon_id", "logs daemon_id");
  if (!daemonId.ok) return daemonId;
  const installId = readOptionalText(body, "install_id", "logs install_id");
  if (!installId.ok) return installId;
  const repoUrl = readOptionalText(body, "repo_url", "logs repo_url");
  if (!repoUrl.ok) return repoUrl;

  return {
    ok: true,
    batch: {
      version: body.version,
      gitAiVersion: gitAiVersion.value,
      daemonId: daemonId.value,
      installId: installId.value,
      repoUrl: repoUrl.value,
      events: body.events,
    },
  };
}

function readOptionalText(
  record: Record<string, unknown>,
  key: string,
  label: string,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (!Object.hasOwn(record, key) || record[key] === null) return { ok: true, value: null };
  if (typeof record[key] !== "string") return { ok: false, error: `${label} must be a string` };
  return { ok: true, value: record[key] };
}
