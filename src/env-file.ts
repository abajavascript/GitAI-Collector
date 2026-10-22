import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ConfigError } from "./config.js";

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Fills missing variables from a dotenv-style file. A value already present in
 * `env` stays as it is, including an empty string. A missing file is ignored.
 */
export function loadEnvFile(env: NodeJS.ProcessEnv = process.env, path = ".env"): void {
  let text: string;
  try {
    text = readFileSync(resolve(path), "utf8");
  } catch (error) {
    if (isNotFound(error)) return;
    throw new ConfigError(`cannot read .env: ${error instanceof Error ? error.message : "unreadable"}`);
  }
  applyEnvText(text, env);
}

export function applyEnvText(text: string, env: NodeJS.ProcessEnv): void {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (line.length === 0 || line.startsWith("#")) continue;
    const body = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const separator = body.indexOf("=");
    if (separator <= 0) throw new ConfigError(`invalid .env line ${index + 1}`);
    const name = body.slice(0, separator).trim();
    if (!NAME.test(name)) throw new ConfigError(`invalid .env name on line ${index + 1}`);
    if (env[name] !== undefined) continue;
    env[name] = unquote(body.slice(separator + 1).trim(), index + 1);
  }
}

function unquote(value: string, line: number): string {
  if (value.length === 0) return value;
  const quote = value[0];
  if (quote !== "\"" && quote !== "'") return value;
  if (value.length < 2 || !value.endsWith(quote)) {
    throw new ConfigError(`unclosed quote in .env on line ${line}`);
  }
  const inner = value.slice(1, -1);
  if (quote === "'") return inner;
  return inner.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\"/g, "\"");
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
