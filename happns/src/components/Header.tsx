import Link from "next/link";
import { Logo } from "./Logo";
import { HeaderNavLink } from "./HeaderNavLink";

export function Header() {
  return (
    <header className="sticky top-0 z-20 frosted border-b border-[var(--border)]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
        <Link
          href="/"
          className="flex items-center gap-2 group"
          aria-label="happns home"
        >
          <Logo size={22} />
          <span className="font-semibold tracking-tight text-[15px] group-hover:text-[var(--accent)] transition-colors">
            happns
          </span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <HeaderNavLink href="/events">Browse</HeaderNavLink>
          <HeaderNavLink href="/saved">Saved</HeaderNavLink>
          <HeaderNavLink href="/settings">Settings</HeaderNavLink>
        </nav>
      </div>
    </header>
  );
}
