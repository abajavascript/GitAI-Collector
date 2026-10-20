import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { openCollectorStore, type CollectorStore } from "../src/store/index.js";

const API_KEY = "collector-key";

function testConfig(sqlitePath = ":memory:", extra: Record<string, string> = {}) {
  return loadConfig({
    SQLITE_PATH: sqlitePath,
    API_KEYS: API_KEY,
    BEARER_TOKENS: "collector-token",
    ...extra,
  });
}

async function withApp(
  fn: (app: FastifyInstance, store: CollectorStore) => Promise<void>,
  extra: Record<string, string> = {},
): Promise<void> {
  const store = openCollectorStore(":memory:");
  const app = buildApp({ config: testConfig(":memory:", extra), store, logger: false });
  try {
    await fn(app, store);
  } finally {
    await app.close();
  }
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "x-api-key": API_KEY,
    "x-distinct-id": "device-1",
    "x-author-identity": "Ada <ada@example.com>",
    ...extra,
  };
}

const prompt = {
  hash: "abc123",
  content: { messages: [{ role: "user", text: "hello" }] },
  metadata: { kind: "prompt" },
};

test("CAS, notes, logs, and bundles reject a missing credential", async () => {
  await withApp(async (app, store) => {
    const cases = [
      { method: "POST" as const, url: "/worker/cas/upload", payload: { objects: [prompt] } },
      { method: "GET" as const, url: "/worker/cas/?hashes=abc123" },
      {
        method: "POST" as const,
        url: "/worker/notes/upload",
        payload: { entries: [{ commit_sha: "abc123", content: "note" }] },
      },
      { method: "GET" as const, url: "/worker/notes/?commits=abc123" },
      { method: "POST" as const, url: "/worker/logs/upload", payload: { version: 1, events: [] } },
      {
        method: "POST" as const,
        url: "/api/bundles",
        payload: { title: "Review", data: { prompts: { a: { text: "hi" } } } },
      },
    ];
    for (const item of cases) {
      const response = await app.inject({
        method: item.method,
        url: item.url,
        payload: item.payload,
      });
      assert.equal(response.statusCode, 401, item.url);
      assert.deepEqual(response.json(), { error: "unauthorized" });
      assert.equal(response.body.includes(API_KEY), false);
    }
    assert.equal((await store.getCasObjects(["abc123"])).length, 0);
    assert.deepEqual(await store.getNotes(["abc123"]), {});
  });
});

test("CAS upload keeps the first object for a hash and the read route returns it", async () => {
  await withApp(async (app, store) => {
    const first = await app.inject({
      method: "POST",
      url: "/worker/cas/upload",
      headers: headers(),
      payload: {
        objects: [prompt, { hash: "def456", content: { text: "nope" }, metadata: { kind: 1 } }],
      },
    });
    assert.equal(first.statusCode, 200);
    assert.deepEqual(first.json(), {
      results: [
        { hash: "abc123", status: "ok" },
        { hash: "def456", status: "error", error: "cas metadata values must be strings" },
      ],
      success_count: 1,
      failure_count: 1,
    });

    const replay = await app.inject({
      method: "POST",
      url: "/worker/cas/upload",
      headers: headers({ "x-distinct-id": "device-2" }),
      payload: {
        objects: [{ ...prompt, content: { messages: [{ role: "user", text: "changed" }] } }],
      },
    });
    assert.equal(replay.statusCode, 200);
    assert.deepEqual(replay.json(), {
      results: [{ hash: "abc123", status: "ok" }],
      success_count: 1,
      failure_count: 0,
    });

    const read = await app.inject({
      method: "GET",
      url: "/worker/cas/?hashes=abc123,missing",
      headers: headers(),
    });
    assert.equal(read.statusCode, 200);
    assert.deepEqual(read.json(), {
      results: [
        { hash: "abc123", status: "ok", content: prompt.content },
        { hash: "missing", status: "error", error: "not found" },
      ],
      success_count: 1,
      failure_count: 1,
    });

    const miss = await app.inject({
      method: "GET",
      url: "/worker/cas/?hashes=missing",
      headers: headers(),
    });
    assert.equal(miss.statusCode, 404);
    assert.deepEqual(miss.json(), { results: [], success_count: 0, failure_count: 1 });

    const stored = await store.getCasObjects(["abc123"]);
    assert.equal(stored.length, 1);
    assert.deepEqual(stored[0]?.content, prompt.content);
    assert.deepEqual(stored[0]?.metadata, { kind: "prompt" });
    assert.equal(stored[0]?.distinctId, "device-1");
    assert.equal(stored[0]?.authorIdentity, "Ada <ada@example.com>");
  });
});

test("a malformed CAS upload is 400 and stores nothing", async () => {
  await withApp(async (app, store) => {
    const response = await app.inject({
      method: "POST",
      url: "/worker/cas/upload",
      headers: headers(),
      payload: { objects: "nope" },
    });
    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), { error: "cas objects must be an array" });

    const invalidJson = await app.inject({
      method: "POST",
      url: "/worker/cas/upload",
      headers: { ...headers(), "content-type": "application/json" },
      payload: "{",
    });
    assert.equal(invalidJson.statusCode, 400);
    assert.deepEqual(invalidJson.json(), { error: "invalid request body" });
    assert.equal((await store.getCasObjects(["abc123"])).length, 0);
  });
});

test("notes replace the same commit and a total miss is an empty 404", async () => {
  await withApp(async (app) => {
    const first = await app.inject({
      method: "POST",
      url: "/worker/notes/upload",
      headers: headers(),
      payload: {
        entries: [
          { commit_sha: "abc123", content: "first" },
          { commit_sha: " ", content: "bad" },
          { commit_sha: "def456" },
        ],
      },
    });
    assert.equal(first.statusCode, 200);
    assert.deepEqual(first.json(), { success_count: 1, failure_count: 2 });

    const replacement = await app.inject({
      method: "POST",
      url: "/worker/notes/upload",
      headers: headers({ "x-distinct-id": "device-2" }),
      payload: { entries: [{ commit_sha: "abc123", content: "second" }] },
    });
    assert.equal(replacement.statusCode, 200);
    assert.deepEqual(replacement.json(), { success_count: 1, failure_count: 0 });

    const read = await app.inject({
      method: "GET",
      url: "/worker/notes/?commits=abc123,missing",
      headers: headers(),
    });
    assert.equal(read.statusCode, 200);
    assert.deepEqual(read.json(), { notes: { abc123: "second" } });

    const miss = await app.inject({
      method: "GET",
      url: "/worker/notes/?commits=missing",
      headers: headers(),
    });
    assert.equal(miss.statusCode, 404);
    assert.deepEqual(miss.json(), { notes: {} });

    const malformed = await app.inject({
      method: "POST",
      url: "/worker/notes/upload",
      headers: headers(),
      payload: {},
    });
    assert.equal(malformed.statusCode, 400);
    assert.deepEqual(malformed.json(), { error: "notes entries must be an array" });
  });
});

test("a logs upload stores an event once and reports validation errors", async () => {
  await withApp(async (app) => {
    const events = [
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
    ];
    const first = await app.inject({
      method: "POST",
      url: "/worker/logs/upload",
      headers: headers(),
      payload: {
        version: 1,
        git_ai_version: "1.2.3",
        daemon_id: "daemon-1",
        install_id: "install-1",
        repo_url: "https://example.com/repo.git",
        events,
      },
    });
    assert.equal(first.statusCode, 200);
    assert.deepEqual(first.json(), {
      accepted: 2,
      dropped: 0,
      enqueued: false,
      errors: [{ index: 2, error: "unsupported log kind" }],
    });

    const again = await app.inject({
      method: "POST",
      url: "/worker/logs/upload",
      headers: headers(),
      payload: {
        version: 1,
        events: [
          {
            id: "event-1",
            kind: "log",
            timestamp: "2026-06-26T12:00:03.000Z",
            level: "info",
            message: "changed",
          },
        ],
      },
    });
    assert.equal(again.statusCode, 200);
    assert.deepEqual(again.json(), { accepted: 0, dropped: 1, enqueued: false, errors: [] });

    const unsupported = await app.inject({
      method: "POST",
      url: "/worker/logs/upload",
      headers: headers(),
      payload: { version: 2, events: [] },
    });
    assert.equal(unsupported.statusCode, 400);
    assert.deepEqual(unsupported.json(), { error: "unsupported logs version" });
  });
});

test("bundle create returns a link to the stored JSON", async () => {
  await withApp(async (app, store) => {
    const created = await app.inject({
      method: "POST",
      url: "/api/bundles",
      headers: headers(),
      payload: {
        title: " Review ",
        data: { prompts: { a: { text: "hi" } }, files: { "src/app.ts": { diff: "" } } },
      },
    });
    assert.equal(created.statusCode, 200);
    const body = created.json() as { success: boolean; id: string; url: string };
    assert.equal(body.success, true);
    assert.match(body.id, /^[0-9a-f-]{36}$/i);
    assert.equal(body.url, `${app.config.publicBaseUrl}/api/bundles/${body.id}`);

    const loaded = await app.inject({
      method: "GET",
      url: body.url.slice(app.config.publicBaseUrl.length),
      headers: headers(),
    });
    assert.equal(loaded.statusCode, 200);
    assert.deepEqual(loaded.json(), {
      title: "Review",
      data: { prompts: { a: { text: "hi" } }, files: { "src/app.ts": { diff: "" } } },
    });

    const stored = await store.getBundle(body.id);
    assert.equal(stored?.distinctId, "device-1");
    assert.equal(stored?.authorIdentity, "Ada <ada@example.com>");

    const missing = await app.inject({
      method: "GET",
      url: "/api/bundles/missing",
      headers: headers(),
    });
    assert.equal(missing.statusCode, 404);
    assert.deepEqual(missing.json(), { error: "bundle not found" });

    const blank = await app.inject({
      method: "POST",
      url: "/api/bundles",
      headers: headers(),
      payload: { title: " ", data: { prompts: {} } },
    });
    assert.equal(blank.statusCode, 400);
    assert.deepEqual(blank.json(), { error: "bundle title is required" });
  }, { PUBLIC_BASE_URL: "https://collector.example" });
});

test("a CAS database failure is 500 and does not report partial success", async () => {
  const dir = mkdtempSync(join(tmpdir(), "git-ai-collector-"));
  const sqlitePath = join(dir, "collector.sqlite");
  const store = openCollectorStore(sqlitePath);
  const app = buildApp({ config: testConfig(sqlitePath), store, logger: false });
  const probe = new DatabaseSync(sqlitePath);
  try {
    probe.exec("PRAGMA busy_timeout = 5000");
    probe.exec(`
      CREATE TRIGGER cas_objects_fail
      BEFORE INSERT ON cas_objects
      BEGIN
        SELECT RAISE(ABORT, 'forced failure');
      END;
    `);

    const response = await app.inject({
      method: "POST",
      url: "/worker/cas/upload",
      headers: headers(),
      payload: {
        objects: [
          prompt,
          { hash: "def456", content: { messages: [] }, metadata: { kind: "transcript" } },
        ],
      },
    });
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), { error: "failed to store cas objects" });
    assert.equal(response.body.includes("success_count"), false);
    assert.equal(response.body.includes("results"), false);
    assert.equal(response.body.includes(API_KEY), false);
    assert.equal((await store.getCasObjects(["abc123", "def456"])).length, 0);

    probe.exec("DROP TRIGGER cas_objects_fail");
    const retry = await app.inject({
      method: "POST",
      url: "/worker/cas/upload",
      headers: headers(),
      payload: { objects: [prompt] },
    });
    assert.equal(retry.statusCode, 200);
    assert.deepEqual(retry.json(), {
      results: [{ hash: "abc123", status: "ok" }],
      success_count: 1,
      failure_count: 0,
    });
    assert.equal((await store.getCasObjects(["abc123"])).length, 1);
  } finally {
    probe.close();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
