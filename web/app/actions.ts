"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { dashboardPassword } from "../lib/env";
import { safeNext } from "../lib/safe-next";
import { passwordMatches, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, signSession } from "../lib/session";

export async function login(formData: FormData): Promise<void> {
  const password = await dashboardPassword();
  if (password === undefined) redirect("/");
  const submitted = formData.get("password");
  const candidate = typeof submitted === "string" ? submitted : "";
  if (!passwordMatches(candidate, password)) redirect("/login?error=1");

  const headerList = await headers();
  const jar = await cookies();
  jar.set(SESSION_COOKIE, signSession(password), {
    httpOnly: true,
    sameSite: "lax",
    secure: requestIsSecure(headerList),
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  const next = formData.get("next");
  redirect(safeNext(typeof next === "string" ? next : "/"));
}

export async function logout(): Promise<void> {
  const headerList = await headers();
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: requestIsSecure(headerList),
    path: "/",
    maxAge: 0,
  });
  const password = await dashboardPassword();
  redirect(password === undefined ? "/" : "/login");
}

function requestIsSecure(headerList: Headers): boolean {
  return headerList.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase() === "https";
}
