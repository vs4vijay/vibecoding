import type { Event } from "../types";
import { fetchLumaHtml } from "./client";
import { normalizeLumaEvent } from "./normalize";
import { extractLumaNextData, findLumaEvents } from "./parse";

/**
 * Luma's discovery URLs are surprisingly inconsistent across cities:
 * - Some have rich `/<slug>` city pages (Bengaluru → 20 events)
 * - Others have a curated empty calendar at `/<slug>` and the actual events
 *   live at a different slug (San Francisco → /sf, not /san-francisco)
 * - All cities also have a `/discover/<slug>` endpoint with a smaller sample
 *
 * This map redirects to the slug that returns the most events. Unmapped
 * inputs fall back to slugify(input).
 */
const CITY_ALIASES: Record<string, string> = {
  bangalore: "bengaluru",
  bombay: "mumbai",
  calcutta: "kolkata",
  madras: "chennai",
  "san francisco": "sf",
  "san francisco bay area": "sf",
  "san-francisco": "sf",
  bay: "sf",
  "new york": "nyc",
  "new-york": "nyc",
};

function slugifyCity(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function candidateUrls(input: string): string[] {
  const lower = input.trim().toLowerCase();
  const alias = CITY_ALIASES[lower];
  const slug = slugifyCity(input);
  const urls = new Set<string>();
  if (alias) urls.add(`https://luma.com/${alias}`);
  if (slug) {
    urls.add(`https://luma.com/${slug}`);
    urls.add(`https://luma.com/discover/${slug}`);
  }
  return [...urls];
}

export async function searchLumaEvents(location: string): Promise<Event[]> {
  const trimmed = location.trim();
  if (!trimmed) return [];

  // Try each candidate in order, stop at the first non-empty result.
  for (const url of candidateUrls(trimmed)) {
    const events = await fetchAndParse(url);
    if (events.length > 0) return events;
  }
  return [];
}

async function fetchAndParse(url: string): Promise<Event[]> {
  const html = await fetchLumaHtml(url);
  if (!html) return [];
  const data = extractLumaNextData(html);
  if (!data) return [];

  const records = findLumaEvents(data.pageProps);
  const events: Event[] = [];
  const seen = new Set<string>();
  for (const r of records) {
    const e = normalizeLumaEvent(r);
    if (!e) continue;
    const key = `${e.source}:${e.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push(e);
  }
  return events.sort((a, b) => a.dateTime.localeCompare(b.dateTime));
}
