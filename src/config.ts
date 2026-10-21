import { readFileSync } from "node:fs";
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
  credentials: readonly Credential[];
  publicBaseUrl: string;
}

export type ReadScope = "*" | readonly string[];

export interface Credential {
  id: string;
  secret: string;
  write: boolean;
  read: ReadScope;
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
  const credentials = loadCredentials(readString(env, "KEYS_FILE"), apiKeys, bearerTokens);
  const publicBaseUrl = (
    readString(env, "PUBLIC_BASE_URL") ?? `http://127.0.0.1:${port}`
  ).replace(/\/+$/, "");

  return Object.freeze({
    host,
    port,
    sqlitePath,
    apiKeys: Object.freeze(apiKeys),
    bearerTokens: Object.freeze(bearerTokens),
    credentials: Object.freeze(credentials),
    publicBaseUrl,
  });
}

function loadCredentials(
  keysFile: string | undefined,
  apiKeys: readonly string[],
  bearerTokens: readonly string[],
): Credential[] {
  if (keysFile === undefined) {
    return [
      ...apiKeys.map((secret, index) => ({
        id: `legacy-api-${index + 1}`,
        secret,
        write: true,
        read: [`legacy-api-${index + 1}`],
      })),
      ...bearerTokens.map((secret, index) => ({
        id: `legacy-bearer-${index + 1}`,
        secret,
        write: true,
        read: [`legacy-bearer-${index + 1}`],
      })),
    ];
  }
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(resolve(keysFile), "utf8"));
  } catch (error) {
    throw new ConfigError(`cannot read KEYS_FILE: ${error instanceof Error ? error.message : "invalid JSON"}`);
  }
  if (value === null || typeof value !== "object" || !Array.isArray((value as { keys?: unknown }).keys)) {
    throw new ConfigError("KEYS_FILE must contain a keys array");
  }
  const ids = new Set<string>();
  const secrets = new Set<string>();
  return (value as { keys: unknown[] }).keys.map((item, index) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new ConfigError(`KEYS_FILE keys[${index}] must be an object`);
    }
    const key = item as Record<string, unknown>;
    const id = nonBlankString(key.id, `KEYS_FILE keys[${index}].id`);
    const secret = nonBlankString(key.secret, `KEYS_FILE keys[${index}].secret`);
    if (ids.has(id)) throw new ConfigError(`KEYS_FILE has duplicate id: ${id}`);
    if (secrets.has(secret)) throw new ConfigError("KEYS_FILE secrets must be unique");
    ids.add(id);
    secrets.add(secret);
    if (typeof key.write !== "boolean") throw new ConfigError(`KEYS_FILE keys[${index}].write must be boolean`);
    const read = key.read === "*" ? "*" : readScope(key.read, index);
    return Object.freeze({ id, secret, write: key.write, read });
  });
}

function nonBlankString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new ConfigError(`${name} must be a non-empty string`);
  return value.trim();
}

function readScope(value: unknown, index: number): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)) {
    throw new ConfigError(`KEYS_FILE keys[${index}].read must be "*" or an array of key ids`);
  }
  return Object.freeze([...new Set(value.map((entry) => (entry as string).trim()))]);
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
