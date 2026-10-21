import type { FastifyInstance, FastifyRequest } from "fastify";

import type { CredentialScope, ReadFilters } from "../store/types.js";
import { repoKey } from "../store/sqlite.js";
import { isRecord } from "./http.js";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

export function registerReadApiRoutes(app: FastifyInstance): void {
  app.get("/api/v1/access", async (request, reply) => {
    const credential = request.credential;
    if (credential === null || emptyRead(credential.read)) return reply.code(403).send({ error: "read access denied" });
    return { id: credential.id, read: credential.read };
  });

  app.get("/api/v1/metrics", async (request, reply) => {
    const parsed = readFilters(request);
    if (!parsed.ok) return reply.code(parsed.status).send({ error: parsed.error });
    const rows = await app.store.listMetricEvents(parsed.scope, parsed.filters);
    return page(rows.map((row) => ({
      id: row.id, credential_id: row.credentialId, repo_url: row.repoUrl, repo_key: row.repoKey,
      branch: row.branch, author: row.author, commit_sha: row.commitSha, tool: row.tool,
      model: row.model, session: row.sessionId, timestamp: row.eventTs, event: row.eventId, raw: row.raw,
    })));
  });

  app.get("/api/v1/token-usage", async (request, reply) => {
    const parsed = readFilters(request);
    if (!parsed.ok) return reply.code(parsed.status).send({ error: parsed.error });
    const rows = await app.store.listTokenUsage(parsed.scope, parsed.filters);
    return page(rows.map((row) => ({
      id: row.id, credential_id: row.credentialId, repo_url: row.repoUrl, repo_key: row.repoKey,
      branch: row.branch, author: row.author, commit_sha: row.commitSha, tool: row.tool,
      session: row.sessionId, model: row.model, bucket_ts: row.bucketTs, input_tokens: row.inputTokens,
      output_tokens: row.outputTokens, total_tokens: row.totalTokens, est_cost_micro_usd: row.estCostMicroUsd,
      raw: row.raw,
    })));
  });

  app.get("/api/v1/prompts", async (request, reply) => {
    const parsed = readFilters(request);
    if (!parsed.ok) return reply.code(parsed.status).send({ error: parsed.error });
    const rows = await app.store.listCasObjects(parsed.scope, parsed.filters);
    return page(rows.map((row) => ({
      id: row.id, hash: row.hash, content: row.content, metadata: row.metadata, credential_id: row.credentialId,
      repo_url: row.repoUrl, repo_key: row.repoKey, branch: row.branch,
    })));
  });

  app.get("/api/v1/notes", async (request, reply) => {
    const parsed = readFilters(request);
    if (!parsed.ok) return reply.code(parsed.status).send({ error: parsed.error });
    const rows = await app.store.listNotes(parsed.scope, parsed.filters);
    return page(rows.map((row) => ({ id: row.id, commit_sha: row.commitSha, content: row.content, credential_id: row.credentialId })));
  });
}

function readFilters(request: FastifyRequest):
  | { ok: true; scope: CredentialScope; filters: ReadFilters }
  | { ok: false; status: 400 | 403; error: string } {
  const credential = request.credential;
  if (credential === null || emptyRead(credential.read)) return { ok: false, status: 403, error: "read access denied" };
  const query = isRecord(request.query) ? request.query : {};
  const key = stringQuery(query, "key");
  if (key !== undefined && credential.read !== "*" && !credential.read.includes(key)) {
    return { ok: false, status: 403, error: "key is outside read scope" };
  }
  const limit = integerQuery(query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const cursor = integerQuery(query.cursor, undefined, 0, Number.MAX_SAFE_INTEGER);
  const from = integerQuery(query.from, undefined, 0, Number.MAX_SAFE_INTEGER);
  const to = integerQuery(query.to, undefined, 0, Number.MAX_SAFE_INTEGER);
  const eventId = integerQuery(query.event, undefined, 0, Number.MAX_SAFE_INTEGER);
  if ([limit, cursor, from, to, eventId].some((value) => value === null)) return { ok: false, status: 400, error: "invalid query parameter" };
  return {
    ok: true,
    scope: key === undefined ? credential.read : [key],
    filters: {
      credentialId: key,
      repoKey: repoKey(stringQuery(query, "repo") ?? null) ?? undefined,
      branch: stringQuery(query, "branch"),
      from: from ?? undefined, to: to ?? undefined, eventId: eventId ?? undefined,
      limit: limit ?? DEFAULT_LIMIT, afterId: cursor ?? undefined,
    },
  };
}

function page<T extends { id?: number }>(items: T[]): { items: T[]; cursor: number | null } {
  const last = items.at(-1)?.id;
  return { items, cursor: last === undefined ? null : last };
}

function emptyRead(scope: CredentialScope): boolean {
  return Array.isArray(scope) && scope.length === 0;
}

function stringQuery(query: Record<string, unknown>, name: string): string | undefined {
  const value = query[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function integerQuery(value: unknown, fallback: number | undefined, min: number, max: number): number | null | undefined {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= min && result <= max ? result : null;
}
