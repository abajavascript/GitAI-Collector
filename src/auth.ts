import { timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

import type { CollectorConfig, Credential } from "./config.js";
import type { RowIdentity } from "./store/types.js";

export interface AuthSuccess {
  ok: true;
  identity: RowIdentity;
  credential: Credential;
}

export interface AuthFailure {
  ok: false;
}

export type AuthResult = AuthSuccess | AuthFailure;

/**
 * Accepts a configured `X-API-Key`, or a configured `Authorization: Bearer` token.
 * When both headers are present, a matching API key is enough: the CLI also sends
 * a Git AI Cloud JWT while the user is logged in, and that JWT is not a collector token.
 */
export function authenticate(
  headers: IncomingHttpHeaders,
  config: Pick<CollectorConfig, "credentials">,
): AuthResult {
  const apiKey = headerText(headers, "x-api-key");
  const apiKeyCredential = apiKey === undefined ? undefined : matchingCredential(apiKey, config.credentials);
  const bearer = readBearer(headers);
  const credential = apiKeyCredential ?? (bearer === undefined ? undefined : matchingCredential(bearer, config.credentials));
  if (credential === undefined) return { ok: false };
  return { ok: true, identity: { ...readIdentity(headers), credentialId: credential.id }, credential };
}

function readIdentity(headers: IncomingHttpHeaders): RowIdentity {
  return {
    distinctId: blankToNull(headerText(headers, "x-distinct-id")),
    authorIdentity: decodeAuthorIdentity(headerText(headers, "x-author-identity")),
  };
}

function headerText(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return typeof value === "string" ? value : undefined;
}

function readBearer(headers: IncomingHttpHeaders): string | undefined {
  const value = headerText(headers, "authorization");
  if (value === undefined) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(value);
  if (match === null) return undefined;
  const token = match[1]?.trim() ?? "";
  return token.length === 0 ? undefined : token;
}

function blankToNull(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function decodeAuthorIdentity(value: string | undefined): string | null {
  const trimmed = blankToNull(value);
  if (trimmed === null) return null;
  try {
    return blankToNull(decodeURIComponent(trimmed));
  } catch {
    return trimmed;
  }
}

function matchingCredential(candidate: string, allowed: readonly Credential[]): Credential | undefined {
  const left = Buffer.from(candidate);
  for (const value of allowed) {
    if (fixedTimeEqual(left, Buffer.from(value.secret))) return value;
  }
  return undefined;
}

function fixedTimeEqual(left: Buffer, right: Buffer): boolean {
  const length = Math.max(left.length, right.length, 1);
  const a = Buffer.alloc(length);
  const b = Buffer.alloc(length);
  left.copy(a);
  right.copy(b);
  return timingSafeEqual(a, b) && left.length === right.length;
}
