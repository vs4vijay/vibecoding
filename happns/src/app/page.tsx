import Link from "next/link";
import { LocationSearch } from "@/components/LocationSearch";

const POPULAR_CITIES = [
  "San Francisco",
  "New York",
  "London",
  "Bangalore",
  "Berlin",
  "Toronto",
];

export default function Home() {
  return (
    <main className="flex-1">
      <section className="hero-grid">
        <div className="max-w-3xl mx-auto px-6 pt-20 pb-24 sm:pt-28 sm:pb-32 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--accent-soft)] text-[var(--accent-strong)] text-xs font-medium mb-6">
            <span className="size-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
            Events from across the web
          </div>
          <h1 className="text-5xl sm:text-6xl font-semibold tracking-tight mb-5">
            Find what&apos;s happening{" "}
            <span className="bg-gradient-to-r from-[var(--accent)] to-[var(--accent-strong)] bg-clip-text text-transparent">
              near you
            </span>
            .
          </h1>
          <p className="text-lg text-[var(--muted)] mb-10 max-w-xl mx-auto">
            One search, every source. No account, no clutter, no login walls.
          </p>
          <div className="max-w-xl mx-auto">
            <LocationSearch size="lg" autoFocus />
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs">
            <span className="text-[var(--muted)] mr-1">Popular:</span>
            {POPULAR_CITIES.map((city) => (
              <Link
                key={city}
                href={`/events?location=${encodeURIComponent(city)}`}
                className="px-3 py-1 rounded-full bg-[var(--surface)] border border-[var(--border)] text-[var(--foreground)] hover:border-[var(--accent)] hover:text-[var(--accent-strong)] transition"
              >
                {city}
              </Link>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
