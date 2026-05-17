import Link from "next/link";
import { SaveButton } from "./SaveButton";
import { SourceBadge } from "./SourceBadge";
import type { Event } from "@/lib/sources/types";

interface EventCardProps {
  event: Event;
}

export function EventCard({ event }: EventCardProps) {
  const date = parseDate(event.dateTime);
  const venue = formatVenue(event);
  const eventHref = event.detailHref ?? event.eventUrl;
  const isExternal = !event.detailHref;
  const linkProps = isExternal
    ? { target: "_blank" as const, rel: "noopener noreferrer" as const }
    : {};

  return (
    <div className="card-lift group relative rounded-2xl overflow-hidden bg-[var(--surface)] border border-[var(--border)] flex flex-col">
      <Link
        href={eventHref}
        {...linkProps}
        className="block relative aspect-[16/10] overflow-hidden"
      >
        {event.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={event.imageUrl}
            alt=""
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[var(--accent-soft)] via-[var(--surface-elevated)] to-[var(--surface)]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent" />

        {date ? (
          <div className="absolute top-3 left-3 bg-[var(--surface)] rounded-xl px-2.5 py-1.5 shadow-sm border border-[var(--border)] text-center min-w-[44px]">
            <p className="text-[10px] uppercase tracking-wide font-semibold text-[var(--accent)] leading-none">
              {date.month}
            </p>
            <p className="text-base font-semibold text-[var(--foreground)] leading-tight mt-0.5">
              {date.day}
            </p>
          </div>
        ) : null}

        <div className="absolute top-3 right-3 flex items-center gap-1">
          <ExternalLink href={event.eventUrl} />
          <SaveButton
            event={{
              id: event.id,
              groupSlug: event.group.urlname,
              title: event.title,
              dateTime: event.dateTime,
            }}
            tone="overlay"
          />
        </div>

        <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-2">
          {date ? (
            <p className="text-xs font-medium text-white drop-shadow">
              {date.time}
            </p>
          ) : (
            <span />
          )}
          <SourceBadge source={event.source} />
        </div>
      </Link>

      <div className="p-4 flex flex-col gap-2 flex-1">
        <Link href={eventHref} {...linkProps} className="block">
          <h3 className="font-semibold text-[15px] leading-snug clamp-2 group-hover:text-[var(--accent-strong)] transition-colors">
            {event.title}
          </h3>
        </Link>

        {event.source === "meetup" && event.group.urlname ? (
          <Link
            href={`/g/${event.group.urlname}`}
            className="text-sm text-[var(--muted)] hover:text-[var(--foreground)] clamp-1 transition-colors w-fit max-w-full"
          >
            {event.group.name}
          </Link>
        ) : (
          <p className="text-sm text-[var(--muted)] clamp-1">
            {event.group.name}
          </p>
        )}

        <div className="mt-auto pt-2 border-t border-[var(--border)] text-xs text-[var(--muted)] space-y-1">
          <p className="flex items-center gap-1.5 clamp-1">
            <PinIcon />
            <span className="clamp-1">{venue}</span>
          </p>
          {typeof event.going === "number" ? (
            <p className="flex items-center gap-1.5">
              <UsersIcon />
              <span>{event.going} going</span>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ExternalLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Open on source"
      className="inline-flex items-center justify-center size-8 rounded-full bg-[var(--surface)]/90 backdrop-blur text-[var(--foreground)] hover:bg-[var(--surface)] border border-[var(--border)] transition"
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
    </a>
  );
}

function PinIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M20 10c0 7-8 13-8 13s-8-6-8-13a8 8 0 0 1 16 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function formatVenue(event: Event): string {
  if (event.isOnline) return "Online";
  const v = event.venue;
  if (!v) return "Venue TBD";
  const name = v.name?.trim();
  const locParts = [v.city, v.state]
    .map((s) => s?.trim())
    .filter((s): s is string => Boolean(s));
  if (name && locParts.length > 0) return `${name} · ${locParts.join(", ")}`;
  return name || locParts.join(", ") || "Venue TBD";
}

interface ParsedDate {
  month: string;
  day: string;
  time: string;
}

function parseDate(iso: string): ParsedDate | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return {
    month: d.toLocaleString(undefined, { month: "short" }),
    day: String(d.getDate()),
    time: d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }),
  };
}
