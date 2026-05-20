import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "DRISHTI",
  description: "Dementia Risk and Imaging-Subgroup Health Trajectory Index",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
            <Link href="/" className="font-mono text-lg font-bold tracking-tight">
              DRISHTI
            </Link>
            <nav className="flex gap-4 text-sm">
              <Link className="hover:underline" href="/participants">Participants</Link>
              <Link className="hover:underline" href="/jobs">Jobs</Link>
              <Link className="hover:underline" href="/harmonisation">Harmonisation</Link>
              <Link className="hover:underline" href="/models">Models</Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
