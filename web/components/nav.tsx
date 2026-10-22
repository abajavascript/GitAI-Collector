import { Suspense } from "react";
import { logout } from "../app/actions";
import { NavLinks } from "./nav-links";

export function Nav({ locked }: { locked: boolean }) {
  return (
    <header className="top">
      <div className="brand">GitAI Collector</div>
      <Suspense fallback={<nav className="links" aria-label="Розділи" />}>
        <NavLinks />
      </Suspense>
      {locked ? (
        <form action={logout}>
          <button type="submit">Вийти</button>
        </form>
      ) : null}
    </header>
  );
}
