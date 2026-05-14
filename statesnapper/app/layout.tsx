import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "statesnapper",
  description: "Stateful API ingest with DB-layer versioning",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header style={{ padding: "12px 24px", borderBottom: "1px solid #2a2a2a" }}>
          <nav style={{ display: "flex", gap: 16, fontFamily: "system-ui" }}>
            <a href="/">home</a>
            <a href="/sources">sources</a>
            <a href="/entities">entities</a>
            <a href="/runs">runs</a>
            <a href="/changes">changes</a>
            <a href="/schedules">schedules</a>
            <a href="/ddl-log">ddl</a>
          </nav>
        </header>
        <main style={{ padding: 24, fontFamily: "system-ui", maxWidth: 1200, margin: "0 auto" }}>
          {children}
        </main>
      </body>
    </html>
  );
}
