import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";

import { authenticate } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { buildApp } from "../src/app.js";
import { openCollectorStore } from "../src/store/index.js";

const API_KEY = "collector-key";
const BEARER = "collector-token";
const CLOUD_JWT = "git-ai-cloud-jwt";

function config() {
  return loadConfig({
    SQLITE_PATH: ":memory:",
    API_KEYS: API_KEY,
    BEARER_TOKENS: BEARER,
  });
}

test("authenticate accepts a configured API key and records caller identity", () => {
  const result = authenticate(
    {
      "x-api-key": API_KEY,
      authorization: `Bearer ${CLOUD_JWT}`,
      "x-distinct-id": " device-1 ",
      "x-author-identity": "Ex%C3%B6utf8lastname <user@example.com>",
    },
    config(),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.identity.distinctId, "device-1");
  assert.equal(result.identity.authorIdentity, "Exöutf8lastname <user@example.com>");
});

test("authenticate accepts a configured bearer token when the API key does not match", () => {
  const result = authenticate(
    {
      "x-api-key": "wrong-key",
      authorization: `bearer ${BEARER}`,
      "x-distinct-id": "device-2",
    },
    config(),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.identity.distinctId, "device-2");
  assert.equal(result.identity.authorIdentity, null);
});

test("authenticate rejects missing, unknown, and malformed credentials", () => {
  const cases = [
    {},
    { "x-api-key": "wrong-key" },
    { authorization: `Bearer ${CLOUD_JWT}` },
    { "x-api-key": "wrong-key", authorization: `Bearer ${CLOUD_JWT}` },
    { authorization: "Bearer" },
    { authorization: "Basic collector-token" },
    { "x-api-key": API_KEY.slice(0, -1) },
  ];
  for (const headers of cases) {
    assert.deepEqual(authenticate(headers, config()), { ok: false });
  }
  assert.deepEqual(authenticate({ "x-api-key": API_KEY }, loadConfig({ API_KEYS: "", BEARER_TOKENS: "" })), {
    ok: false,
  });
});

test("authenticate decodes percent-encoded author identity and keeps an undecodable value", () => {
  const decoded = authenticate(
    { "x-api-key": API_KEY, "x-author-identity": "100%25 done" },
    config(),
  );
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.equal(decoded.identity.authorIdentity, "100% done");

  const raw = authenticate(
    { "x-api-key": API_KEY, "x-author-identity": "100% done" },
    config(),
  );
  assert.equal(raw.ok, true);
  if (!raw.ok) return;
  assert.equal(raw.identity.authorIdentity, "100% done");
});

test("GET /health stays open and other routes require a configured credential", async () => {
  const store = openCollectorStore(":memory:");
  const app = buildApp({ config: config(), store, logger: false });
  let handled = false;
  app.post("/worker/metrics/upload", async () => {
    handled = true;
    return { errors: [] };
  });

  const health = await app.inject({ method: "GET", url: "/health" });
  assert.equal(health.statusCode, 200);

  const missing = await app.inject({ method: "POST", url: "/worker/metrics/upload" });
  assert.equal(missing.statusCode, 401);
  assert.deepEqual(missing.json(), { error: "unauthorized" });
  assert.equal(missing.body.includes(API_KEY), false);
  assert.equal(handled, false);

  const wrongKey = await app.inject({
    method: "POST",
    url: "/worker/metrics/upload",
    headers: { "x-api-key": "wrong-key", authorization: `Bearer ${CLOUD_JWT}` },
  });
  assert.equal(wrongKey.statusCode, 401);
  assert.equal(handled, false);

  await app.close();
});

test("a matching API key is enough when a cloud token is also sent", async () => {
  const store = openCollectorStore(":memory:");
  const app = buildApp({ config: config(), store, logger: false });
  app.post("/worker/metrics/upload", async (request) => request.identity);

  const response = await app.inject({
    method: "POST",
    url: "/worker/metrics/upload",
    headers: {
      "x-api-key": API_KEY,
      authorization: `Bearer ${CLOUD_JWT}`,
      "x-distinct-id": "device-1",
      "x-author-identity": "Ada%20<ada@example.com>",
    },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    distinctId: "device-1",
    authorIdentity: "Ada <ada@example.com>",
  });

  await app.close();
});

test("authenticated uploads store distinct id and decoded author identity", async () => {
  const store = openCollectorStore(":memory:");
  const app = buildApp({ config: config(), store, logger: false });
  app.post("/api/bundles", async (request) => {
    const record = await app.store.createBundle(request.identity, {
      title: "probe",
      data: { prompts: { a: 1 } },
    });
    return { id: record.id };
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/bundles",
    headers: {
      authorization: `Bearer ${BEARER}`,
      "x-distinct-id": "device-9",
      "x-author-identity": "Ex%C3%B6utf8lastname <user@example.com>",
    },
  });
  assert.equal(response.statusCode, 200);
  const id = response.json().id as string;
  const stored = await app.store.getBundle(id);
  assert.ok(stored);
  assert.equal(stored.distinctId, "device-9");
  assert.equal(stored.authorIdentity, "Exöutf8lastname <user@example.com>");

  await app.close();
});

test("request logs do not include API keys or bearer tokens", async () => {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  const store = openCollectorStore(":memory:");
  const app = buildApp({ config: config(), store, logStream: stream });
  app.post("/worker/logs/upload", async () => ({ accepted: 0, dropped: 0, enqueued: 0, errors: [] }));

  const denied = await app.inject({
    method: "POST",
    url: "/worker/logs/upload",
    headers: { "x-api-key": "wrong-key", authorization: `Bearer ${CLOUD_JWT}` },
  });
  assert.equal(denied.statusCode, 401);

  const allowed = await app.inject({
    method: "POST",
    url: "/worker/logs/upload",
    headers: { "x-api-key": API_KEY, authorization: `Bearer ${CLOUD_JWT}` },
  });
  assert.equal(allowed.statusCode, 200);

  const logged = lines.join("");
  assert.match(logged, /\/worker\/logs\/upload/);
  assert.equal(logged.includes(API_KEY), false);
  assert.equal(logged.includes(CLOUD_JWT), false);
  assert.equal(logged.includes("wrong-key"), false);

  await app.close();
});
