import { resolve } from "node:path";

export class ConfigError extends Error {
  override readonly name = "ConfigError";

  constructor(message: string) {
    super(message);
  }
}

export interface CollectorConfig {
  host: string;
  port: number;
  sqlitePath: string;
  apiKeys: readonly string[];
  bearerTokens: readonly string[];
  publicBaseUrl: string;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8080;
const DEFAULT_SQLITE_PATH = "data/collector.sqlite";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CollectorConfig {
  const host = readString(env, "HOST") ?? DEFAULT_HOST;
  const port = readPort(readString(env, "PORT"), DEFAULT_PORT);
  const configuredPath = readString(env, "SQLITE_PATH") ?? DEFAULT_SQLITE_PATH;
  const sqlitePath = configuredPath === ":memory:" ? configuredPath : resolve(configuredPath);
  const apiKeys = readList(readString(env, "API_KEYS"));
  const bearerTokens = readList(readString(env, "BEARER_TOKENS"));
  const publicBaseUrl = (
    readString(env, "PUBLIC_BASE_URL") ?? `http://127.0.0.1:${port}`
  ).replace(/\/+$/, "");

  return Object.freeze({
    host,
    port,
    sqlitePath,
    apiKeys: Object.freeze(apiKeys),
    bearerTokens: Object.freeze(bearerTokens),
    publicBaseUrl,
  });
}

function readString(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function readPort(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) {
    throw new ConfigError("PORT must be an integer between 1 and 65535");
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError("PORT must be an integer between 1 and 65535");
  }
  return port;
}

function readList(value: string | undefined): string[] {
  if (value === undefined) return [];
  const seen = new Set<string>();
  const items: string[] = [];
  for (const part of value.split(",")) {
    const item = part.trim();
    if (item.length === 0 || seen.has(item)) continue;
    seen.add(item);
    items.push(item);
  }
  return items;
}
