import Link from "next/link";
import { SaveButton } from "./SaveButton";
import type { Event } from "@/lib/meetup/types";

interface EventDetailProps {
  event: Event;
}

export function EventDetail({ event }: EventDetailProps) {
  const dt = formatDateTime(event.dateTime);
  const date = parseDate(event.dateTime);
  const venueLabel = formatVenue(event);

  return (
    <article className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      {event.imageUrl ? (
        <div className="relative aspect-[2/1] overflow-hidden rounded-3xl mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={event.imageUrl}
            alt=""
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
        </div>
      ) : null}

      <header className="mb-8">
        <Link
          href={`/g/${event.group.urlname}`}
          className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--accent-strong)] transition mb-3"
        >
          <span className="size-1.5 rounded-full bg-[var(--accent)]" />
          {event.group.name}
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight leading-tight">
            {event.title}
          </h1>
          <div className="shrink-0">
            <SaveButton
              event={{
                id: event.id,
                groupSlug: event.group.urlname,
                title: event.title,
                dateTime: event.dateTime,
              }}
              variant="button"
            />
          </div>
        </div>
      </header>

      <div className="grid sm:grid-cols-2 gap-3 mb-8">
        <InfoTile
          icon={<CalendarIcon />}
          label="When"
          primary={date?.short ?? dt}
          secondary={date?.time}
        />
        <InfoTile
          icon={<PinIcon />}
          label="Where"
          primary={venueLabel.line1}
          secondary={venueLabel.line2}
        />
        {typeof event.going === "number" ? (
          <InfoTile
            icon={<UsersIcon />}
            label="Going"
            primary={`${event.going} ${event.going === 1 ? "attendee" : "attendees"}`}
          />
        ) : null}
        {event.hosts && event.hosts.length > 0 ? (
          <InfoTile
            icon={<StarIcon />}
            label="Hosted by"
            primary={event.hosts.map((h) => h.name).join(", ")}
          />
        ) : null}
      </div>

      {event.description ? (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-8 mb-6">
          <h2 className="text-sm uppercase tracking-wide font-semibold text-[var(--muted)] mb-4">
            About this event
          </h2>
          <p className="whitespace-pre-line text-[var(--foreground)] leading-relaxed">
            {event.description}
          </p>
        </section>
      ) : null}

      <footer className="pt-2">
        <a
          href={event.eventUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-[var(--accent-strong)] hover:underline"
        >
          View on meetup.com
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
            <path d="M7 17L17 7" />
            <path d="M7 7h10v10" />
          </svg>
        </a>
      </footer>
    </article>
  );
}

interface InfoTileProps {
  icon: React.ReactNode;
  label: string;
  primary: string;
  secondary?: string;
}

function InfoTile({ icon, label, primary, secondary }: InfoTileProps) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 flex gap-3">
      <div className="size-9 shrink-0 inline-flex items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-strong)]">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide font-semibold text-[var(--muted)]">
          {label}
        </p>
        <p className="font-medium text-[var(--foreground)] truncate">
          {primary}
        </p>
        {secondary ? (
          <p className="text-sm text-[var(--muted)] truncate">{secondary}</p>
        ) : null}
      </div>
    </div>
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

function parseDate(iso: string): { short: string; time: string } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return {
    short: d.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    }),
    time: d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }),
  };
}

interface VenueLines {
  line1: string;
  line2: string;
}

function formatVenue(event: Event): VenueLines {
  if (event.isOnline) return { line1: "Online event", line2: "" };
  const v = event.venue;
  if (!v) return { line1: "Venue TBD", line2: "" };
  const name = v.name?.trim() ?? "";
  const loc = [v.address, v.city, v.state]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p))
    .join(", ");
  return name
    ? { line1: name, line2: loc }
    : { line1: loc || "Venue TBD", line2: "" };
}

function CalendarIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 10c0 7-8 13-8 13s-8-6-8-13a8 8 0 0 1 16 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}
