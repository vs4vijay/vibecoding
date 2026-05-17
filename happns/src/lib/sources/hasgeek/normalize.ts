import type { Event, Venue } from "../types";
import type { HasgeekRawEvent } from "./parse";

const EVENT_URL_BASE = "https://hasgeek.com";

const MONTHS: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  sept: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

export function normalizeHasgeekEvent(raw: HasgeekRawEvent): Event | null {
  const startDate = raw.startDate ?? fallbackDateFromAriaLabel(raw.ariaLabel);
  if (!startDate) return null;

  const startIso = combineDateAndTime(startDate, raw.timeRange, "start");
  const endIso = raw.endDate
    ? combineDateAndTime(raw.endDate, raw.timeRange, "end")
    : combineDateAndTime(startDate, raw.timeRange, "end");

  // Slug is the second path segment, e.g. /tech4food/foo/ → "foo".
  const id = slugFromHref(raw.href);
  if (!id) return null;

  // Group urlname is the first path segment (account slug).
  const account = accountFromHref(raw.href);

  const venue = parseVenue(raw.location);

  return {
    source: "hasgeek",
    id,
    title: cleanTitle(raw.title),
    dateTime: startIso,
    endTime: endIso !== startIso ? endIso : undefined,
    eventUrl: `${EVENT_URL_BASE}${raw.href}`,
    detailHref: undefined,
    description: raw.subtitle,
    venue,
    group: {
      urlname: account,
      name: raw.series ?? "HasGeek",
      city: venue?.city,
    },
    imageUrl: raw.imageUrl,
    isOnline: !raw.location,
  };
}

function cleanTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim();
}

function slugFromHref(href: string): string {
  const parts = href.split("/").filter(Boolean);
  return parts[1] ?? "";
}

function accountFromHref(href: string): string {
  const parts = href.split("/").filter(Boolean);
  return parts[0] ?? "";
}

function parseVenue(loc: string | undefined): Venue | undefined {
  if (!loc) return undefined;
  // Trailing-comma form is common: "Food Safety Works, Bengaluru,".
  const trimmed = loc.replace(/,$/, "").trim();
  if (!trimmed) return undefined;
  const parts = trimmed.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 1) {
    return { city: parts[0] };
  }
  const city = parts[parts.length - 1];
  const name = parts.slice(0, -1).join(", ");
  return { name, city };
}

function combineDateAndTime(
  isoDate: string,
  timeRange: string | undefined,
  end: "start" | "end",
): string {
  // The page renders times like "06:00 PM – 07:00 PM IST". For ISO output we
  // treat IST as +05:30; if the timezone differs the day is still right and
  // sorting stays stable, which is what the multi-source merge cares about.
  const range = parseTimeRange(timeRange);
  if (!range) return `${isoDate}T00:00:00+05:30`;
  const time = end === "start" ? range.start : range.end ?? range.start;
  return `${isoDate}T${time}+05:30`;
}

function parseTimeRange(
  raw: string | undefined,
): { start: string; end?: string } | null {
  if (!raw) return null;
  const cleaned = raw.replace(/ /g, " ").trim();
  const parts = cleaned.split(/[–-]/).map((s) => s.trim());
  const start = parseClockTime(parts[0]);
  const end = parts[1] ? parseClockTime(parts[1]) : null;
  if (!start) return null;
  return { start, end: end ?? undefined };
}

function parseClockTime(raw: string | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return null;
  let h = Number(m[1]);
  const mm = m[2];
  const ampm = (m[3] ?? "").toUpperCase();
  if (ampm === "PM" && h < 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${mm}:00`;
}

function fallbackDateFromAriaLabel(label: string | undefined): string | null {
  if (!label) return null;
  // "22 May 2026, ..." or "12–13 Jun 2026, ..." — grab the first month + year.
  const m = label.match(/(\d{1,2})[\s–—-]*(?:\d{1,2})?\s+([A-Za-z]+)\s+(\d{4})/);
  if (!m) return null;
  const day = m[1].padStart(2, "0");
  const monthKey = m[2].toLowerCase().slice(0, 4).replace(/[^a-z]/g, "");
  const month = MONTHS[monthKey] ?? MONTHS[monthKey.slice(0, 3)];
  if (!month) return null;
  return `${m[3]}-${month}-${day}`;
}
