import "server-only";
import { cookies, headers } from "next/headers";
import { dashboardPassword } from "./env";
import { hostsAreLocal } from "./host";
import { SESSION_COOKIE, verifySession } from "./session";

export type Gate =
  | { kind: "ok"; locked: boolean }
  | { kind: "login" }
  | { kind: "localhost-only" };

export async function dashboardGate(): Promise<Gate> {
  const password = await dashboardPassword();
  const headerList = await headers();
  if (password === undefined) {
    return hostsAreLocal(headerList) ? { kind: "ok", locked: false } : { kind: "localhost-only" };
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return verifySession(token, password) ? { kind: "ok", locked: true } : { kind: "login" };
}
