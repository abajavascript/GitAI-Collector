import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../src/config.js";
import { buildApp } from "../src/app.js";
import { openCollectorStore } from "../src/store/index.js";

test("GET /health reports the store is open", async () => {
  const config = loadConfig({ SQLITE_PATH: ":memory:", PORT: "8080" });
  const store = openCollectorStore(":memory:");
  const app = buildApp({ config, store, logger: false });

  const response = await app.inject({ method: "GET", url: "/health" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ok: true });

  await app.close();
});
