"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface HeaderNavLinkProps {
  href: string;
  children: React.ReactNode;
}

export function HeaderNavLink({ href, children }: HeaderNavLinkProps) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`px-3 py-1.5 rounded-full transition-colors ${
        active
          ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]"
          : "text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-elevated)]"
      }`}
    >
      {children}
    </Link>
  );
}
