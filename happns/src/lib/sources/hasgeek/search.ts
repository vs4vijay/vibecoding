import type { Event } from "../types";
import { fetchHasgeekHtml } from "./client";
import { normalizeHasgeekEvent } from "./normalize";
import { parseHasgeekUpcoming } from "./parse";

const HASGEEK_HOME = "https://hasgeek.com/";

/**
 * HasGeek doesn't have a city URL — the homepage lists all upcoming events
 * (usually a handful at a time). We fetch once and filter client-side by a
 * substring match against the rendered location text.
 */
export async function searchHasgeekEvents(location: string): Promise<Event[]> {
  const html = await fetchHasgeekHtml(HASGEEK_HOME);
  if (!html) return [];
  const raw = parseHasgeekUpcoming(html);

  const events: Event[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const ev = normalizeHasgeekEvent(r);
    if (!ev) continue;
    if (!matchesLocation(ev, location)) continue;
    const key = `${ev.source}:${ev.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push(ev);
  }
  return events.sort((a, b) => a.dateTime.localeCompare(b.dateTime));
}

function matchesLocation(event: Event, location: string): boolean {
  const needle = location.trim().toLowerCase();
  if (!needle) return true;
  // Common Indian-city aliases we already handle in Luma adapter — accept the
  // historical names too.
  const aliases: Record<string, string[]> = {
    bangalore: ["bangalore", "bengaluru"],
    bengaluru: ["bangalore", "bengaluru"],
    bombay: ["bombay", "mumbai"],
    mumbai: ["bombay", "mumbai"],
    calcutta: ["calcutta", "kolkata"],
    kolkata: ["calcutta", "kolkata"],
    madras: ["madras", "chennai"],
    chennai: ["madras", "chennai"],
  };
  const needles = aliases[needle] ?? [needle];

  const hay = [
    event.venue?.name,
    event.venue?.city,
    event.venue?.address,
    event.group.city,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return needles.some((n) => hay.includes(n));
}
