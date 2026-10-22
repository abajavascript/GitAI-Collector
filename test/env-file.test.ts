import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ConfigError } from "../src/config.js";
import { applyEnvText, loadEnvFile } from "../src/env-file.js";

test("applyEnvText fills only missing names", () => {
  const env: NodeJS.ProcessEnv = { API_KEYS: "from-shell", EMPTY: "" };
  applyEnvText(
    "\uFEFF# comment\n\nexport HOST=127.0.0.1\nAPI_KEYS=from-file\nEMPTY=filled\nPORT=\"8080\"\nNOTE='a\\n'\n",
    env,
  );
  assert.equal(env.HOST, "127.0.0.1");
  assert.equal(env.API_KEYS, "from-shell");
  assert.equal(env.EMPTY, "");
  assert.equal(env.PORT, "8080");
  assert.equal(env.NOTE, "a\\n");
});

test("applyEnvText expands escapes inside double quotes", () => {
  const env: NodeJS.ProcessEnv = {};
  applyEnvText(String.raw`MESSAGE="a\nb"`, env);
  assert.equal(env.MESSAGE, "a\nb");
});

test("applyEnvText rejects a broken line", () => {
  assert.throws(() => applyEnvText("NOT A PAIR", {}), ConfigError);
  assert.throws(() => applyEnvText("1BAD=value", {}), ConfigError);
  assert.throws(() => applyEnvText("QUOTED=\"open", {}), ConfigError);
});

test("loadEnvFile reads a file and ignores a missing one", () => {
  const dir = mkdtempSync(join(tmpdir(), "collector-env-"));
  try {
    const env: NodeJS.ProcessEnv = {};
    loadEnvFile(env, join(dir, "missing.env"));
    assert.deepEqual(env, {});

    const file = join(dir, ".env");
    writeFileSync(file, "KEYS_FILE=data/keys.json\nBEARER_TOKENS=\n");
    loadEnvFile(env, file);
    assert.equal(env.KEYS_FILE, "data/keys.json");
    assert.equal(env.BEARER_TOKENS, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
