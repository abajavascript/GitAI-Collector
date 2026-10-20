import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { ConfigError, loadConfig } from "../src/config.js";

test("loadConfig applies defaults", () => {
  const config = loadConfig({});
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 8080);
  assert.equal(config.sqlitePath, resolve("data/collector.sqlite"));
  assert.deepEqual(config.apiKeys, []);
  assert.deepEqual(config.bearerTokens, []);
  assert.equal(config.publicBaseUrl, "http://127.0.0.1:8080");
});

test("loadConfig reads lists, memory database, and strips the public base url", () => {
  const config = loadConfig({
    HOST: "0.0.0.0",
    PORT: "9090",
    SQLITE_PATH: ":memory:",
    API_KEYS: " alpha, beta, alpha ",
    BEARER_TOKENS: "tok-1,tok-1, tok-2",
    PUBLIC_BASE_URL: "https://collector.example/",
  });
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 9090);
  assert.equal(config.sqlitePath, ":memory:");
  assert.deepEqual(config.apiKeys, ["alpha", "beta"]);
  assert.deepEqual(config.bearerTokens, ["tok-1", "tok-2"]);
  assert.equal(config.publicBaseUrl, "https://collector.example");
});

test("loadConfig rejects a port that is not an integer in range", () => {
  assert.throws(() => loadConfig({ PORT: "0" }), ConfigError);
  assert.throws(() => loadConfig({ PORT: "8080abc" }), ConfigError);
  assert.throws(() => loadConfig({ PORT: "70000" }), ConfigError);
});
