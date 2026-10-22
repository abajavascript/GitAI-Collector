"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const LINKS = [
  { href: "/", label: "Доступ" },
  { href: "/token-usage", label: "Token usage" },
  { href: "/metrics", label: "Metrics" },
  { href: "/notes", label: "Notes" },
  { href: "/prompts", label: "Prompts" },
] as const;

const KEPT = ["repo", "branch", "from", "to", "key", "limit"] as const;

export function NavLinks() {
  const pathname = usePathname();
  const params = useSearchParams();
  const next = new URLSearchParams();
  for (const name of KEPT) {
    const value = params.get(name);
    if (value) next.set(name, value);
  }
  const query = next.toString();

  return (
    <nav className="links" aria-label="Розділи">
      {LINKS.map((link) => {
        const href = query ? `${link.href}?${query}` : link.href;
        return (
          <Link key={link.href} href={href} prefetch={false} aria-current={pathname === link.href ? "page" : undefined}>
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
