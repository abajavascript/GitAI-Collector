import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { METRIC_EVENT_ID, openCollectorStore, type CollectorStore } from "../src/store/index.js";

const API_KEY = "collector-key";

function testConfig(sqlitePath = ":memory:") {
  return loadConfig({
    SQLITE_PATH: sqlitePath,
    API_KEYS: API_KEY,
    BEARER_TOKENS: "collector-token",
  });
}

function attrs(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "1": "https://example.com/repo.git",
    "2": "Ada",
    "3": "abc123",
    "5": "main",
    "20": "cursor",
    "21": "gpt-5",
    "24": "sess-1",
    ...extra,
  };
}

function metric(
  extra: { t?: number; e?: number; v?: Record<string, unknown>; a?: Record<string, unknown> } = {},
) {
  return {
    t: extra.t ?? 1_700_000_000,
    e: extra.e ?? METRIC_EVENT_ID.committed,
    v: extra.v ?? { "0": 1 },
    a: extra.a ?? attrs(),
  };
}

function tokenEvent(seq: number, cost = 4_567, speed?: number) {
  const values: Record<string, unknown> = {
    "0": 1_700_000_000,
    "1": 10,
    "2": 20,
    "3": 3,
    "4": 4,
    "5": 42,
    "6": 5,
    "7": cost,
    "8": 1.5,
    "9": 2,
    "10": seq,
    "12": speed === undefined ? 1 : 0,
    "13": 6,
    "14": 7,
    "15": 8,
    "16": 9,
    "17": 10,
    "18": 11,
    "19": 12,
  };
  if (speed !== undefined) values["11"] = speed;
  return metric({ e: METRIC_EVENT_ID.tokenUsage, v: values });
}

async function withApp(
  fn: (app: FastifyInstance, store: CollectorStore) => Promise<void>,
): Promise<void> {
  const store = openCollectorStore(":memory:");
  const app = buildApp({ config: testConfig(), store, logger: false });
  try {
    await fn(app, store);
  } finally {
    await app.close();
  }
}

function upload(app: FastifyInstance, events: readonly unknown[], headers: Record<string, string> = {}) {
  return app.inject({
    method: "POST",
    url: "/worker/metrics/upload",
    headers: {
      "x-api-key": API_KEY,
      "x-distinct-id": "device-1",
      "x-author-identity": "Ada <ada@example.com>",
      ...headers,
    },
    payload: { v: 1, events },
  });
}

test("POST /worker/metrics/upload requires a configured credential", async () => {
  await withApp(async (app, store) => {
    const missing = await app.inject({
      method: "POST",
      url: "/worker/metrics/upload",
      payload: { v: 1, events: [metric()] },
    });
    assert.equal(missing.statusCode, 401);
    assert.deepEqual(missing.json(), { error: "unauthorized" });
    assert.equal(missing.body.includes(API_KEY), false);
    assert.equal((await store.findMetricEventsByCommit("abc123")).length, 0);
  });
});

test("a metrics batch stores raw events and common attributes, and an exact replay is accepted once", async () => {
  await withApp(async (app, store) => {
    const committed = metric();
    const future = metric({
      t: 1_700_000_099,
      e: 42,
      v: { "7": "later" },
      a: attrs({ "3": "future123" }),
    });

    const first = await upload(app, [committed, future]);
    assert.equal(first.statusCode, 200);
    assert.deepEqual(first.json(), { errors: [] });

    const replay = await upload(app, [committed, future]);
    assert.equal(replay.statusCode, 200);
    assert.deepEqual(replay.json(), { errors: [] });

    const stored = await store.findMetricEventsByCommit("abc123");
    assert.equal(stored.length, 1);
    const row = stored[0];
    assert.ok(row);
    assert.equal(row.eventId, METRIC_EVENT_ID.committed);
    assert.equal(row.eventTs, 1_700_000_000);
    assert.equal(row.repoUrl, "https://example.com/repo.git");
    assert.equal(row.author, "Ada");
    assert.equal(row.commitSha, "abc123");
    assert.equal(row.branch, "main");
    assert.equal(row.tool, "cursor");
    assert.equal(row.model, "gpt-5");
    assert.equal(row.sessionId, "sess-1");
    assert.equal(row.distinctId, "device-1");
    assert.equal(row.authorIdentity, "Ada <ada@example.com>");
    assert.deepEqual(row.raw, committed);

    const kept = await store.findMetricEventsByCommit("future123");
    assert.equal(kept.length, 1);
    assert.equal(kept[0]?.eventId, 42);
    assert.deepEqual(kept[0]?.raw, future);
  });
});

test("one invalid metric does not reject the rest of the batch", async () => {
  await withApp(async (app, store) => {
    const response = await upload(app, [metric(), { t: "bad" }, metric({ t: 8 })]);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      errors: [{ index: 1, error: "metric event timestamp must be an integer" }],
    });

    const stored = await store.findMetricEventsByCommit("abc123");
    assert.deepEqual(
      stored.map((event) => event.eventTs),
      [1_700_000_000, 8],
    );
  });
});

test("token usage keeps the highest emitted_seq and a separate speed bucket", async () => {
  await withApp(async (app, store) => {
    const key = { sessionId: "sess-1", model: "gpt-5", speed: 0, bucketTs: 1_700_000_000 };
    const newer = await upload(app, [tokenEvent(2, 100)]);
    assert.equal(newer.statusCode, 200);
    assert.deepEqual(newer.json(), { errors: [] });

    const older = await upload(app, [tokenEvent(1, 1)]);
    assert.equal(older.statusCode, 200);
    assert.deepEqual(older.json(), { errors: [] });

    const fast = await upload(app, [tokenEvent(1, 9, 1)]);
    assert.equal(fast.statusCode, 200);
    assert.deepEqual(fast.json(), { errors: [] });

    const replacement = await upload(app, [tokenEvent(4, 250)]);
    assert.equal(replacement.statusCode, 200);
    assert.deepEqual(replacement.json(), { errors: [] });

    const bucket = await store.getTokenUsageBucket(key);
    assert.ok(bucket);
    assert.equal(bucket.emittedSeq, 4);
    assert.equal(bucket.speed, 0);
    assert.equal(bucket.inputTokens, 10);
    assert.equal(bucket.outputTokens, 20);
    assert.equal(bucket.cacheReadTokens, 3);
    assert.equal(bucket.cacheWriteTokens, 4);
    assert.equal(bucket.cacheWrite1hTokens, 6);
    assert.equal(bucket.reasoningOutputTokens, 5);
    assert.equal(bucket.totalTokens, 42);
    assert.equal(bucket.longContextInputTokens, 7);
    assert.equal(bucket.longContextOutputTokens, 8);
    assert.equal(bucket.longContextCacheReadTokens, 9);
    assert.equal(bucket.longContextCacheWriteTokens, 10);
    assert.equal(bucket.longContextCacheWrite1hTokens, 11);
    assert.equal(bucket.estCostMicroUsd, 250);
    assert.equal(bucket.transcriptCostMicroUsd, 12);
    assert.equal(bucket.credits, 1.5);
    assert.equal(bucket.messageCount, 2);
    assert.equal(bucket.speedInferred, 1);
    assert.equal(bucket.distinctId, "device-1");
    assert.deepEqual(bucket.raw, tokenEvent(4, 250));

    const fastBucket = await store.getTokenUsageBucket({ ...key, speed: 1 });
    assert.ok(fastBucket);
    assert.equal(fastBucket.emittedSeq, 1);
    assert.equal(fastBucket.estCostMicroUsd, 9);
    assert.equal(fastBucket.speedInferred, 0);
  });
});

test("a malformed metrics batch is 400 and stores nothing", async () => {
  await withApp(async (app, store) => {
    const cases = [
      { payload: {}, error: "metrics version must be an integer" },
      { payload: { v: 1 }, error: "metrics events must be an array" },
      { payload: { v: 1, events: "nope" }, error: "metrics events must be an array" },
      { payload: { v: 2, events: [] }, error: "unsupported metrics version" },
      {
        payload: { v: 1, events: Array.from({ length: 1001 }, () => metric()) },
        error: "metrics batch exceeds 1000 events",
      },
    ];
    for (const item of cases) {
      const response = await app.inject({
        method: "POST",
        url: "/worker/metrics/upload",
        headers: { "x-api-key": API_KEY },
        payload: item.payload,
      });
      assert.equal(response.statusCode, 400, item.error);
      assert.deepEqual(response.json(), { error: item.error });
    }

    const invalidJson = await app.inject({
      method: "POST",
      url: "/worker/metrics/upload",
      headers: { "x-api-key": API_KEY, "content-type": "application/json" },
      payload: "{",
    });
    assert.equal(invalidJson.statusCode, 400);
    assert.deepEqual(invalidJson.json(), { error: "invalid request body" });

    const written = await upload(app, [metric({ t: 42 })]);
    assert.equal(written.statusCode, 200);
    assert.deepEqual(written.json(), { errors: [] });
    const stored = await store.findMetricEventsByCommit("abc123");
    assert.equal(stored.length, 1);
    assert.equal(stored[0]?.eventTs, 42);
  });
});

test("a database failure is 500 and does not report partial success", async () => {
  const dir = mkdtempSync(join(tmpdir(), "git-ai-collector-"));
  const sqlitePath = join(dir, "collector.sqlite");
  const store = openCollectorStore(sqlitePath);
  const app = buildApp({ config: testConfig(sqlitePath), store, logger: false });
  const probe = new DatabaseSync(sqlitePath);
  try {
    probe.exec("PRAGMA busy_timeout = 5000");
    probe.exec(`
      CREATE TRIGGER metric_events_fail
      BEFORE INSERT ON metric_events
      BEGIN
        SELECT RAISE(ABORT, 'forced failure');
      END;
    `);

    const response = await upload(app, [metric(), metric({ t: 2, a: attrs({ "3": "def456" }) })]);
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), { error: "failed to store metrics" });
    assert.equal(response.body.includes(API_KEY), false);
    assert.equal(response.body.includes("errors"), false);
    assert.equal((await store.findMetricEventsByCommit("abc123")).length, 0);
    assert.equal((await store.findMetricEventsByCommit("def456")).length, 0);

    probe.exec("DROP TRIGGER metric_events_fail");
    const retry = await upload(app, [metric(), metric({ t: 2, a: attrs({ "3": "def456" }) })]);
    assert.equal(retry.statusCode, 200);
    assert.deepEqual(retry.json(), { errors: [] });
    assert.equal((await store.findMetricEventsByCommit("abc123")).length, 1);
    assert.equal((await store.findMetricEventsByCommit("def456")).length, 1);
  } finally {
    probe.close();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
