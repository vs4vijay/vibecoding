import { fetchGdgText } from "./client";

const SITEMAP_BASE = "https://gdg.community.dev/sitemap-events.xml";
const URL_RE = /<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g;

/**
 * Number of sitemap pages we'll scan to find candidate event URLs. Each page
 * is ~120KB and contains a few hundred URLs. We aren't building a full crawler
 * — we just want enough surface area to catch upcoming events for popular
 * cities. The sitemap pages aren't strictly date-sorted, so we have to scan a
 * decent slice. Fetches are cached for 10 minutes by `fetchGdgText`, so a
 * cold first request is the only one that pays the full cost.
 */
const PAGES_TO_SCAN = 10;

export interface SitemapEntry {
  url: string;
  /** URL slug after /events/details/, used for substring city matching. */
  slug: string;
  /** ISO date string from <lastmod>. */
  lastmod: string;
}

/** Fetch one sitemap page and parse out (url, lastmod) tuples. */
async function fetchPage(page: number): Promise<SitemapEntry[]> {
  // NB: the bare `sitemap-events.xml` URL returns an empty stub. Real content
  // lives only at `?p=N` for N >= 1.
  const url = `${SITEMAP_BASE}?p=${page}`;
  const xml = await fetchGdgText(url);
  if (!xml) return [];

  const out: SitemapEntry[] = [];
  for (const m of xml.matchAll(URL_RE)) {
    const u = m[1];
    const lastmod = m[2];
    const slug = slugFromUrl(u);
    if (!slug) continue;
    out.push({ url: u, slug, lastmod });
  }
  return out;
}

function slugFromUrl(url: string): string {
  // .../events/details/<slug>/
  const m = url.match(/\/events\/details\/([^/]+)\/?$/);
  return m?.[1] ?? "";
}

export async function collectGdgEventUrls(): Promise<SitemapEntry[]> {
  const pages = await Promise.all(
    Array.from({ length: PAGES_TO_SCAN }, (_, i) => fetchPage(i + 1)),
  );
  const seen = new Set<string>();
  const out: SitemapEntry[] = [];
  for (const arr of pages) {
    for (const e of arr) {
      if (seen.has(e.url)) continue;
      seen.add(e.url);
      out.push(e);
    }
  }
  return out;
}
