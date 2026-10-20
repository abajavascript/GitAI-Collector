import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CollectorStoreError,
  METRIC_EVENT_ID,
  openCollectorStore,
  type CollectorStore,
  type RowIdentity,
} from "../src/store/index.js";

const identity: RowIdentity = {
  distinctId: "device-1",
  authorIdentity: "Ada <ada@example.com>",
};

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

function metric(extra: { t?: number; e?: number; v?: Record<string, unknown>; a?: Record<string, unknown> } = {}) {
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
    "6": 5,
    "7": cost,
    "10": seq,
    "14": 2,
  };
  if (speed !== undefined) values["11"] = speed;
  return metric({ e: METRIC_EVENT_ID.tokenUsage, v: values });
}

async function withStore(fn: (store: CollectorStore) => Promise<void>): Promise<void> {
  const store = openCollectorStore(":memory:");
  try {
    await fn(store);
  } finally {
    await store.close();
  }
}

function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  assert.ok(item);
  return item;
}

test("metric batches store common attributes, ignore an exact replay, and keep a valid sibling", async () => {
  await withStore(async (store) => {
    const event = metric();
    const reordered = {
      a: { "24": "sess-1", "21": "gpt-5", "20": "cursor", "5": "main", "3": "abc123", "2": "Ada", "1": "https://example.com/repo.git" },
      v: { "0": 1 },
      e: METRIC_EVENT_ID.committed,
      t: 1_700_000_000,
    };
    const first = await store.writeMetrics(identity, {
      version: 1,
      events: [event, { t: "bad" }, reordered],
    });
    assert.equal(at(first.results, 0).status, "stored");
    assert.equal(at(first.results, 1).status, "error");
    assert.equal(at(first.results, 2).status, "duplicate");

    const stored = await store.findMetricEventsByCommit("abc123");
    assert.equal(stored.length, 1);
    const row = at(stored, 0);
    assert.equal(row.repoUrl, "https://example.com/repo.git");
    assert.equal(row.author, "Ada");
    assert.equal(row.commitSha, "abc123");
    assert.equal(row.branch, "main");
    assert.equal(row.tool, "cursor");
    assert.equal(row.model, "gpt-5");
    assert.equal(row.sessionId, "sess-1");
    assert.equal(row.distinctId, identity.distinctId);
    assert.equal(row.authorIdentity, identity.authorIdentity);
    assert.deepEqual(row.raw, event);
  });
});

test("token usage keeps the highest emitted_seq and ignores an older revision", async () => {
  await withStore(async (store) => {
    const key = { sessionId: "sess-1", model: "gpt-5", speed: 0, bucketTs: 1_700_000_000 };
    const newer = await store.writeMetrics(identity, { version: 1, events: [tokenEvent(2, 100)] });
    assert.equal(at(newer.results, 0).status, "stored");

    const older = await store.writeMetrics(identity, { version: 1, events: [tokenEvent(1, 1)] });
    assert.equal(at(older.results, 0).status, "stale");
    const replay = await store.writeMetrics(identity, { version: 1, events: [tokenEvent(1, 1)] });
    assert.equal(at(replay.results, 0).status, "duplicate");

    const fast = await store.writeMetrics(identity, { version: 1, events: [tokenEvent(1, 9, 1)] });
    assert.equal(at(fast.results, 0).status, "stored");
    const replacement = await store.writeMetrics(identity, { version: 1, events: [tokenEvent(4, 250)] });
    assert.equal(at(replacement.results, 0).status, "stored");

    const bucket = await store.getTokenUsageBucket(key);
    assert.ok(bucket);
    assert.equal(bucket.emittedSeq, 4);
    assert.equal(bucket.estCostMicroUsd, 250);
    assert.equal(bucket.inputTokens, 10);
    assert.equal(bucket.outputTokens, 20);
    assert.equal(bucket.cacheReadTokens, 3);
    assert.equal(bucket.cacheWriteTokens, 4);
    assert.equal(bucket.reasoningOutputTokens, 5);
    assert.equal(bucket.longContextInputTokens, 2);
    assert.equal(bucket.speed, 0);
    assert.equal(bucket.distinctId, identity.distinctId);

    const fastBucket = await store.getTokenUsageBucket({ ...key, speed: 1 });
    assert.ok(fastBucket);
    assert.equal(fastBucket.emittedSeq, 1);
    assert.equal(fastBucket.estCostMicroUsd, 9);
  });
});

test("a rejected metrics batch does not leave a transaction open", async () => {
  await withStore(async (store) => {
    await assert.rejects(
      () => store.writeMetrics(identity, { version: 2, events: [] }),
      (error: unknown) => error instanceof CollectorStoreError && error.message === "unsupported metrics version",
    );
    await assert.rejects(
      () => store.writeMetrics(identity, { version: 1, events: Array.from({ length: 1001 }, () => metric()) }),
      CollectorStoreError,
    );
    const written = await store.writeMetrics(identity, { version: 1, events: [metric({ t: 42 })] });
    assert.equal(at(written.results, 0).status, "stored");
  });
});

test("cas keeps the first object for a hash and notes replace by commit", async () => {
  await withStore(async (store) => {
    const first = await store.putCasObjects(identity, [
      { hash: "abc", content: { text: "one" }, metadata: { kind: "prompt" } },
      { hash: " ", content: { text: "nope" }, metadata: {} },
    ]);
    assert.equal(at(first.results, 0).status, "stored");
    assert.equal(at(first.results, 1).status, "error");
    assert.equal(first.successCount, 1);
    assert.equal(first.failureCount, 1);

    const second = await store.putCasObjects(
      { distinctId: "other", authorIdentity: "Bea" },
      [{ hash: "abc", content: { text: "two" }, metadata: { kind: "other" } }],
    );
    assert.equal(at(second.results, 0).status, "exists");
    const objects = await store.getCasObjects(["abc", "missing"]);
    assert.equal(objects.length, 1);
    assert.deepEqual(at(objects, 0).content, { text: "one" });
    assert.deepEqual(at(objects, 0).metadata, { kind: "prompt" });
    assert.equal(at(objects, 0).distinctId, "device-1");

    const notes = await store.upsertNotes(identity, [
      { commitSha: "abc123", content: "first" },
      { commitSha: " ", content: "bad" },
    ]);
    assert.deepEqual(notes, { successCount: 1, failureCount: 1 });
    await store.upsertNotes(
      { distinctId: "other", authorIdentity: "Bea" },
      [{ commitSha: "abc123", content: "second" }],
    );
    assert.deepEqual(await store.getNotes(["abc123", "missing"]), { abc123: "second" });
  });
});

test("log events with an id are stored once and bundles round-trip", async () => {
  await withStore(async (store) => {
    const batch = {
      version: 1,
      gitAiVersion: "1.2.3",
      daemonId: "daemon-1",
      installId: "install-1",
      repoUrl: "https://example.com/repo.git",
      events: [
        {
          id: "event-1",
          kind: "heartbeat",
          timestamp: "2026-06-26T12:00:00.000Z",
          level: "info",
          message: "alive",
          fields: { uptime_seconds: 900, healthy: true },
        },
        { kind: "log", timestamp: "2026-06-26T12:00:01.000Z", level: "warn", message: "once" },
        { kind: "nope", timestamp: "2026-06-26T12:00:02.000Z", level: "info", message: "bad" },
      ],
    };
    const first = await store.writeLogs(identity, batch);
    assert.equal(first.accepted, 2);
    assert.equal(first.dropped, 0);
    assert.equal(first.errors.length, 1);

    const again = await store.writeLogs(identity, {
      ...batch,
      events: [{ id: "event-1", kind: "log", timestamp: "2026-06-26T12:00:03.000Z", level: "info", message: "changed" }],
    });
    assert.deepEqual(again, { accepted: 0, dropped: 1, errors: [] });

    await assert.rejects(() => store.createBundle(identity, { title: "  ", data: {} }), CollectorStoreError);
    const created = await store.createBundle(identity, { title: " Review ", data: { prompts: { a: 1 } } });
    assert.equal(created.body && typeof created.body === "object" && "title" in created.body, true);
    assert.deepEqual(created.body, { title: "Review", data: { prompts: { a: 1 } } });
    assert.equal(created.distinctId, identity.distinctId);
    const loaded = await store.getBundle(created.id);
    assert.deepEqual(loaded, created);
    assert.equal(await store.getBundle("missing"), null);
  });
});

test("a sqlite file survives close and reopen", async () => {
  const dir = mkdtempSync(join(tmpdir(), "git-ai-collector-"));
  const sqlitePath = join(dir, "nested", "collector.sqlite");
  try {
    const store = openCollectorStore(sqlitePath);
    await store.writeMetrics(identity, { version: 1, events: [metric({ t: 7 })] });
    await store.close();

    const reopened = openCollectorStore(sqlitePath);
    const events = await reopened.findMetricEventsByCommit("abc123");
    assert.equal(events.length, 1);
    assert.equal(at(events, 0).eventTs, 7);
    await reopened.close();
    await reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
