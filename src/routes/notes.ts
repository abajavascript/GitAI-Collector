import type { FastifyInstance } from "fastify";

import { CollectorStoreError } from "../store/errors.js";
import type { NoteInput } from "../store/types.js";
import { isRecord, queryList, setClientErrorHandler } from "./http.js";

const STORE_FAILURE = "failed to store notes";

/**
 * CLI contract for POST /worker/notes/upload and GET /worker/notes/?commits=.
 * A newer note replaces the same commit SHA. When none of the requested SHAs
 * are stored, the response is 404 `{ notes: {} }`. The CLI treats that 404
 * as an empty success.
 */
export function registerNoteRoutes(app: FastifyInstance): void {
  app.register(async (scope) => {
    setClientErrorHandler(scope, "notes request failed", STORE_FAILURE);

    scope.post("/worker/notes/upload", async (request, reply) => {
      const parsed = readNotesUpload(request.body);
      if (!parsed.ok) return reply.code(400).send({ error: parsed.error });

      try {
        const written = await app.store.upsertNotes(request.identity, parsed.entries);
        return {
          success_count: written.successCount,
          failure_count: written.failureCount + parsed.failureCount,
        };
      } catch (error) {
        if (error instanceof CollectorStoreError) {
          return reply.code(400).send({ error: error.message });
        }
        request.log.error({ err: error }, "notes upload failed");
        return reply.code(500).send({ error: STORE_FAILURE });
      }
    });

    scope.get("/worker/notes", async (request, reply) => {
      const commits = queryList(request.query, "commits");
      const notes = await app.store.getNotes(commits);
      if (Object.keys(notes).length === 0) {
        return reply.code(404).send({ notes: {} });
      }
      return { notes };
    });
  });
}

function readNotesUpload(
  body: unknown,
): { ok: true; entries: NoteInput[]; failureCount: number } | { ok: false; error: string } {
  if (!isRecord(body)) return { ok: false, error: "invalid request body" };
  if (!Array.isArray(body.entries)) return { ok: false, error: "notes entries must be an array" };

  const entries: NoteInput[] = [];
  let failureCount = 0;
  for (const entry of body.entries) {
    if (!isRecord(entry) || typeof entry.commit_sha !== "string" || typeof entry.content !== "string") {
      failureCount += 1;
      continue;
    }
    entries.push({ commitSha: entry.commit_sha, content: entry.content });
  }
  return { ok: true, entries, failureCount };
}
