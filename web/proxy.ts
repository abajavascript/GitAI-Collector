import { NextResponse, type NextRequest } from "next/server";
import { hostsAreLocal } from "./lib/host";
import { safeNext } from "./lib/safe-next";
import { SESSION_COOKIE, verifySession } from "./lib/session";

export function proxy(request: NextRequest) {
  const password = process.env["DASHBOARD_PASSWORD"] ?? "";
  if (password.length === 0) {
    if (!hostsAreLocal(request.headers)) {
      return new NextResponse("Без DASHBOARD_PASSWORD дашборд приймає лише localhost.", {
        status: 403,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  if (pathname === "/login") return NextResponse.next();
  if (verifySession(request.cookies.get(SESSION_COOKIE)?.value, password)) return NextResponse.next();

  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  const next = safeNext(`${pathname}${request.nextUrl.search}`);
  if (next !== "/") login.searchParams.set("next", next);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
