import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "dashboard_session";
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

const SESSION_TTL_MS = SESSION_MAX_AGE_SECONDS * 1000;

export function signSession(secret: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ exp: now + SESSION_TTL_MS }), "utf8").toString("base64url");
  return `${payload}.${hmac(secret, payload)}`;
}

export function verifySession(token: string | undefined, secret: string, now = Date.now()): boolean {
  if (token === undefined || secret.length === 0) return false;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return false;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = hmac(secret, payload);
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return false;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || !("exp" in parsed)) return false;
    return typeof parsed.exp === "number" && Number.isFinite(parsed.exp) && parsed.exp > now;
  } catch {
    return false;
  }
}

export function passwordMatches(input: string, expected: string): boolean {
  const actual = createHash("sha256").update(input, "utf8").digest();
  const wanted = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(actual, wanted);
}

function hmac(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}
