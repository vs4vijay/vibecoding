import type { Event } from "../types";
import { fetchGdgText } from "./client";
import { normalizeGdgEvent } from "./normalize";
import { extractGdgEventLd } from "./parse";
import { collectGdgEventUrls, type SitemapEntry } from "./sitemap";

/**
 * Cap on parallel event-detail fetches per search. Each fetch is a single
 * HTML page (~800KB raw, but small once parsed). Keeping this low matters
 * because every page = one Bevy request.
 */
const MAX_DETAIL_FETCHES = 8;

/**
 * City-name aliases. Keys are lowercased, no-special-chars; values list the
 * slug tokens we accept inside a Bevy chapter name. Mirrors the Luma and
 * HasGeek aliases so a search for "Bangalore" finds chapters using either
 * name.
 */
const CITY_ALIASES: Record<string, string[]> = {
  bangalore: ["bangalore", "bengaluru"],
  bengaluru: ["bangalore", "bengaluru"],
  bombay: ["bombay", "mumbai"],
  mumbai: ["bombay", "mumbai"],
  calcutta: ["calcutta", "kolkata"],
  kolkata: ["calcutta", "kolkata"],
  madras: ["madras", "chennai"],
  chennai: ["madras", "chennai"],
  delhi: ["delhi", "new-delhi"],
  "new york": ["nyc", "new-york", "new-york-city"],
  "san francisco": ["san-francisco", "sf", "bay-area"],
};

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function tokenAliases(location: string): string[] {
  const lower = location.trim().toLowerCase();
  const aliases = CITY_ALIASES[lower];
  if (aliases) return aliases;
  return [slugify(location)];
}

/**
 * True when the event-detail slug references one of our city tokens. The
 * Bevy format is `google-gdg-<chapter>-presents-<event>`. We require the
 * city to appear as a `-token-` boundary so "bangalore" doesn't accidentally
 * match unrelated cities that contain the substring.
 */
function slugMatchesCity(slug: string, tokens: string[]): boolean {
  const head = slug.split("-presents-")[0];
  if (!head) return false;
  for (const t of tokens) {
    if (!t) continue;
    const re = new RegExp(`(?:^|-)${t}(?:-|$)`);
    if (re.test(head)) return true;
  }
  return false;
}

/** Skip sitemap entries last edited more than this many days ago — they are
 * almost always archived events, and detail-fetching them just wastes
 * bandwidth. The threshold is generous so a freshly-edited far-future event
 * still lands here. */
const STALE_LASTMOD_DAYS = 90;

export async function searchGdgEvents(location: string): Promise<Event[]> {
  const trimmed = location.trim();
  if (!trimmed) return [];

  const tokens = tokenAliases(trimmed);
  const entries = await collectGdgEventUrls();
  const staleCutoff = Date.now() - STALE_LASTMOD_DAYS * 24 * 3600 * 1000;
  const candidates = entries.filter((e) => {
    if (!slugMatchesCity(e.slug, tokens)) return false;
    const lm = Date.parse(e.lastmod);
    return Number.isFinite(lm) && lm >= staleCutoff;
  });
  if (candidates.length === 0) return [];

  // Most-recently-edited first — these are usually the freshest events.
  candidates.sort((a, b) => b.lastmod.localeCompare(a.lastmod));
  const pick = candidates.slice(0, MAX_DETAIL_FETCHES);

  const fetched = await Promise.allSettled(pick.map(fetchAndParse));
  const now = Date.now();
  const out: Event[] = [];
  for (const r of fetched) {
    if (r.status !== "fulfilled" || !r.value) continue;
    const t = new Date(r.value.dateTime).getTime();
    if (Number.isNaN(t) || t < now) continue;
    out.push(r.value);
  }
  out.sort((a, b) => a.dateTime.localeCompare(b.dateTime));
  return out;
}

async function fetchAndParse(entry: SitemapEntry): Promise<Event | null> {
  const html = await fetchGdgText(entry.url);
  if (!html) return null;
  const ld = extractGdgEventLd(html);
  if (!ld) return null;
  return normalizeGdgEvent(ld, entry.url, entry.slug);
}
