"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSavedEvents, type SavedEvent } from "@/lib/saved";
import type { Event } from "@/lib/meetup/types";

export default function SavedPage() {
  const { saved, removeSaved } = useSavedEvents();
  const loaded = useFreshEvents(saved);

  return (
    <main className="flex-1 max-w-3xl mx-auto px-4 sm:px-6 py-10">
      <div className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-1">
          Saved events
        </h1>
        <p className="text-[var(--muted)]">
          {saved.length === 0
            ? "Nothing saved yet."
            : `${saved.length} bookmarked ${saved.length === 1 ? "event" : "events"}.`}
        </p>
      </div>

      {saved.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border-strong)] py-16 px-6 text-center text-[var(--muted)]">
          Tap the bookmark icon on any event to save it for later.
          <div className="mt-4">
            <Link
              href="/events"
              className="inline-flex items-center px-4 h-10 rounded-xl bg-[var(--accent)] text-[var(--accent-foreground)] text-sm font-medium hover:bg-[var(--accent-strong)] transition"
            >
              Browse events
            </Link>
          </div>
        </div>
      ) : (
        <ul className="space-y-3">
          {saved.map((item) => {
            const key = `${item.groupSlug}:${item.id}`;
            return (
              <SavedRow
                key={key}
                stored={item}
                fresh={loaded.get(key)}
                onRemove={() => removeSaved(item.groupSlug, item.id)}
              />
            );
          })}
        </ul>
      )}
    </main>
  );
}

type FreshState =
  | { status: "loading" }
  | { status: "loaded"; event: Event | null };

function useFreshEvents(saved: SavedEvent[]): Map<string, FreshState> {
  const [results, setResults] = useState<Map<string, FreshState>>(new Map());

  useEffect(() => {
    if (saved.length === 0) return;
    const controller = new AbortController();
    for (const item of saved) {
      const key = `${item.groupSlug}:${item.id}`;
      if (results.has(key)) continue;
      fetch(
        `/api/event?groupSlug=${encodeURIComponent(item.groupSlug)}&eventId=${encodeURIComponent(item.id)}`,
        { signal: controller.signal },
      )
        .then(async (res) => {
          const event = res.ok
            ? ((await res.json()) as { event: Event | null }).event
            : null;
          setResults((prev) => {
            const next = new Map(prev);
            next.set(key, { status: "loaded", event });
            return next;
          });
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setResults((prev) => {
            const next = new Map(prev);
            next.set(key, { status: "loaded", event: null });
            return next;
          });
        });
    }
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  return results;
}

interface SavedRowProps {
  stored: SavedEvent;
  fresh: FreshState | undefined;
  onRemove: () => void;
}

function SavedRow({ stored, fresh, onRemove }: SavedRowProps) {
  const event = fresh?.status === "loaded" ? fresh.event : null;
  const title = event?.title ?? stored.title;
  const dateTime = event?.dateTime ?? stored.dateTime;
  const subtitle = event?.group.name ?? stored.groupSlug.replace(/-/g, " ");
  const dt = formatDateTime(dateTime);
  const loading = !fresh || fresh.status === "loading";
  const removed = fresh?.status === "loaded" && fresh.event === null;
  const eventHref = `/e/${stored.groupSlug}/${stored.id}`;

  return (
    <li className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 flex items-start justify-between gap-4 hover:border-[var(--accent)] transition-colors">
      <Link href={eventHref} className="min-w-0 flex-1 block group">
        <p className="text-xs uppercase tracking-wide text-[var(--accent-strong)] font-semibold">
          {dt}
        </p>
        <p className="font-semibold leading-snug mt-1 group-hover:text-[var(--accent-strong)] transition-colors">
          {title}
        </p>
        <p className="text-sm text-[var(--muted)] capitalize mt-0.5">
          {subtitle}
        </p>
        {loading ? (
          <p className="text-xs text-[var(--muted)] mt-1.5 opacity-60">
            Refreshing…
          </p>
        ) : null}
        {removed ? (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5">
            Event no longer available on meetup.com.
          </p>
        ) : null}
      </Link>
      <div className="flex items-center gap-1 shrink-0">
        <Link
          href={eventHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open event in new tab"
          className="size-8 inline-flex items-center justify-center rounded-full text-[var(--muted)] hover:text-[var(--accent-strong)] hover:bg-[var(--accent-soft)] transition"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M15 3h6v6" />
            <path d="M10 14L21 3" />
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          </svg>
        </Link>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove from saved"
          className="size-8 inline-flex items-center justify-center rounded-full text-[var(--muted)] hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 6h18" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          </svg>
        </button>
      </div>
    </li>
  );
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
