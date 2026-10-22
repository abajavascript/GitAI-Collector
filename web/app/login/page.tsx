import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { login } from "../actions";
import { dashboardPassword } from "../../lib/env";
import { safeNext } from "../../lib/safe-next";
import { SESSION_COOKIE, verifySession } from "../../lib/session";

export const metadata: Metadata = { title: "Вхід" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[]; next?: string | string[] }>;
}) {
  const password = await dashboardPassword();
  if (password === undefined) redirect("/");
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (verifySession(token, password)) redirect("/");

  const params = await searchParams;
  const errorFlag = Array.isArray(params.error) ? params.error[0] : params.error;
  const nextRaw = Array.isArray(params.next) ? params.next[0] : params.next;
  const next = safeNext(nextRaw ?? "/");

  return (
    <main className="login">
      <h1>Вхід</h1>
      <p className="lede">
        Пароль лише відчиняє цей дашборд. Ключ Collector сюди не вводиться: сервер читає його з COLLECTOR_READ_KEY.
      </p>
      {errorFlag === "1" ? <p className="error" role="alert">Пароль не збігається.</p> : null}
      <form action={login}>
        <input type="hidden" name="next" value={next} />
        <label>
          Пароль дашборда
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <button type="submit">Увійти</button>
      </form>
    </main>
  );
}
