import Link from "next/link";
import type { ReactNode } from "react";

type NavGroup = {
  section: string;
  items: { href: string; label: string; icon: string }[];
};

const NAV: NavGroup[] = [
  {
    section: "Overview",
    items: [
      { href: "/", label: "Dashboard", icon: "▣" },
    ],
  },
  {
    section: "Ingest",
    items: [
      { href: "/sources", label: "Sources", icon: "◆" },
      { href: "/schedules", label: "Schedules", icon: "◷" },
      { href: "/runs", label: "Runs", icon: "▶" },
    ],
  },
  {
    section: "Data",
    items: [
      { href: "/entities", label: "Entities", icon: "❒" },
      { href: "/changes", label: "Changes", icon: "↯" },
    ],
  },
  {
    section: "System",
    items: [
      { href: "/ddl-log", label: "DDL Log", icon: "⚙" },
    ],
  },
];

export function AppShell({
  title,
  crumbs,
  actions,
  children,
}: {
  title?: string;
  crumbs?: { href?: string; label: string }[];
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="sidebar-brand" style={{ color: "inherit", textDecoration: "none" }}>
          <div className="logo">S</div>
          <div className="name">syncbase</div>
        </Link>
        {NAV.map((group) => (
          <div key={group.section}>
            <div className="sidebar-section">{group.section}</div>
            {group.items.map((item) => (
              <Link key={item.href} href={item.href} className="sidebar-link">
                <span className="ico">{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            ))}
          </div>
        ))}
      </aside>
      <div className="main">
        <header className="topbar">
          <nav className="crumbs">
            {crumbs && crumbs.length > 0 ? (
              crumbs.map((c, i) => (
                <span key={i}>
                  {i > 0 && <span style={{ margin: "0 8px", color: "var(--text-dim)" }}>/</span>}
                  {c.href ? <Link href={c.href}>{c.label}</Link> : <span>{c.label}</span>}
                </span>
              ))
            ) : (
              <span>{title ?? ""}</span>
            )}
          </nav>
          <div className="actions">{actions}</div>
        </header>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
