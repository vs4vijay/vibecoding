import { getCategory } from "./categories";
import { fetchMeetupHtml } from "./client";
import { normalizeEvent } from "./event";
import { extractNextData, findByTypename } from "./parse";
import type { Event } from "@/lib/sources/types";

export interface SearchOptions {
  location: string;
  keywords?: string;
}

export async function searchEvents(opts: SearchOptions): Promise<Event[]> {
  const location = opts.location.trim();
  if (!location) return [];

  const params = new URLSearchParams({ location, source: "EVENTS" });
  if (opts.keywords && opts.keywords.trim()) {
    params.set("keywords", opts.keywords.trim());
  }

  const url = `https://www.meetup.com/find/?${params.toString()}`;
  const html = await fetchMeetupHtml(url);
  if (!html) return [];

  const data = extractNextData(html);
  if (!data) return [];

  const raws = findByTypename<Record<string, unknown>>(
    data.apolloState,
    "Event",
  );

  const events: Event[] = [];
  for (const raw of raws) {
    if (typeof raw.title !== "string" || !raw.title.trim()) continue;

    const groupSlug = resolveGroupSlug(raw, data.apolloState) ?? "unknown";
    try {
      events.push(
        normalizeEvent(
          raw,
          data.apolloState,
          (raw.eventUrl as string | undefined) ?? url,
          groupSlug,
        ),
      );
    } catch {
      // Skip malformed records rather than failing the whole search.
    }
  }

  return events.sort((a, b) => a.dateTime.localeCompare(b.dateTime));
}

export async function searchEventsByCategories(
  location: string,
  categoryIds: string[],
): Promise<Event[]> {
  const trimmed = location.trim();
  if (!trimmed) return [];

  if (categoryIds.length === 0) {
    return searchEvents({ location: trimmed });
  }

  const keywords = categoryIds
    .map((id) => getCategory(id)?.keyword)
    .filter((k): k is string => Boolean(k));

  if (keywords.length === 0) {
    return searchEvents({ location: trimmed });
  }

  const results = await Promise.all(
    keywords.map((keyword) =>
      searchEvents({ location: trimmed, keywords: keyword }).catch(
        () => [] as Event[],
      ),
    ),
  );

  const seen = new Set<string>();
  const merged: Event[] = [];
  for (const list of results) {
    for (const e of list) {
      const key = `${e.source}:${e.group.urlname}:${e.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(e);
    }
  }
  return merged.sort((a, b) => a.dateTime.localeCompare(b.dateTime));
}

function resolveGroupSlug(
  raw: Record<string, unknown>,
  apolloState: Record<string, Record<string, unknown>>,
): string | undefined {
  const groupRef = raw.group;
  if (!groupRef || typeof groupRef !== "object") return undefined;

  const inline = (groupRef as Record<string, unknown>).urlname;
  if (typeof inline === "string") return inline;

  const refKey = (groupRef as Record<string, unknown>).__ref;
  if (typeof refKey !== "string") return undefined;
  const group = apolloState[refKey];
  const urlname = group?.urlname;
  return typeof urlname === "string" ? urlname : undefined;
}
