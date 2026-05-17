import { fetchMeetupHtml } from "./client";
import {
  type ApolloState,
  deref,
  extractNextData,
  findByTypename,
  getNumber,
  getString,
} from "./parse";
import type { Event, Host, Venue } from "./types";

export async function getEvent(
  groupSlug: string,
  eventId: string,
): Promise<Event | null> {
  const url = buildEventUrl(groupSlug, eventId);
  const html = await fetchMeetupHtml(url);
  if (!html) return null;

  const data = extractNextData(html);
  if (!data) return null;

  const eventRaw = findEventRecord(data.apolloState, eventId);
  if (!eventRaw) return null;

  return normalizeEvent(eventRaw, data.apolloState, url, groupSlug);
}

export function buildEventUrl(groupSlug: string, eventId: string): string {
  return `https://www.meetup.com/${encodeURIComponent(groupSlug)}/events/${encodeURIComponent(eventId)}/`;
}

function findEventRecord(
  apolloState: ApolloState,
  eventId: string,
): Record<string, unknown> | null {
  const directKey = `Event:${eventId}`;
  if (apolloState[directKey]) return apolloState[directKey];

  const candidates = findByTypename<Record<string, unknown>>(
    apolloState,
    "Event",
  );
  // Prefer exact id match; otherwise return the first Event in the cache
  // (event pages usually have a single Event record).
  const match = candidates.find(
    (e) => getString(e, "id") === eventId || getString(e, "eventId") === eventId,
  );
  return match ?? candidates[0] ?? null;
}

export function normalizeEvent(
  raw: Record<string, unknown>,
  apolloState: ApolloState,
  url: string,
  fallbackGroupSlug: string,
): Event {
  const venue = resolveVenue(raw.venue, apolloState);
  const group = resolveGroup(raw.group, apolloState, fallbackGroupSlug);
  const hosts = resolveHosts(raw.eventHosts ?? raw.hosts, apolloState);
  const id =
    getString(raw, "id") ??
    getString(raw, "eventId") ??
    extractEventIdFromUrl(url);
  const eventType = getString(raw, "eventType");

  return {
    id: id ?? "",
    title: getString(raw, "title") ?? "Untitled event",
    dateTime:
      getString(raw, "dateTime") ??
      getString(raw, "time") ??
      new Date(0).toISOString(),
    endTime: getString(raw, "endTime"),
    eventUrl: getString(raw, "eventUrl") ?? url,
    description:
      getString(raw, "description") ?? getString(raw, "howToFindUs"),
    going: resolveGoingCount(raw),
    venue,
    group,
    hosts,
    imageUrl: resolveImageUrl(raw, apolloState),
    isOnline: eventType
      ? eventType.toUpperCase() === "ONLINE"
      : typeof raw.isOnline === "boolean"
        ? (raw.isOnline as boolean)
        : undefined,
    eventType,
  };
}

function resolveGoingCount(raw: Record<string, unknown>): number | undefined {
  const direct =
    getNumber(raw, "going") ??
    getNumber(raw, "yesRsvpCount") ??
    getNumber(raw, "rsvpYesCount");
  if (typeof direct === "number") return direct;

  // Apollo cache stores connections keyed by their args, e.g.
  // `rsvps({"filter":{"rsvpStatus":["YES"]}})` → { totalCount: N }
  for (const [key, value] of Object.entries(raw)) {
    if (!key.startsWith("rsvps(") || !key.includes('"YES"')) continue;
    const total = getNumber(value as Record<string, unknown>, "totalCount");
    if (typeof total === "number") return total;
  }
  return undefined;
}

function resolveVenue(
  value: unknown,
  apolloState: ApolloState,
): Venue | undefined {
  const v = deref(apolloState, value) ?? toRecord(value);
  if (!v) return undefined;
  return {
    name: getString(v, "name"),
    address: getString(v, "address"),
    city: getString(v, "city"),
    state: getString(v, "state"),
    country: getString(v, "country"),
  };
}

function resolveGroup(
  value: unknown,
  apolloState: ApolloState,
  fallbackSlug: string,
): Event["group"] {
  const g = deref(apolloState, value) ?? toRecord(value);
  return {
    urlname: getString(g, "urlname") ?? fallbackSlug,
    name: getString(g, "name") ?? fallbackSlug,
    city: getString(g, "city"),
    country: getString(g, "country"),
  };
}

function resolveHosts(value: unknown, apolloState: ApolloState): Host[] {
  if (!Array.isArray(value)) return [];
  const out: Host[] = [];
  for (const entry of value) {
    const rec = deref(apolloState, entry) ?? toRecord(entry);
    if (!rec) continue;
    const name = getString(rec, "name");
    if (!name) continue;
    out.push({ name, memberId: getString(rec, "id") });
  }
  return out;
}

function resolveImageUrl(
  raw: Record<string, unknown>,
  apolloState: ApolloState,
): string | undefined {
  for (const key of ["featuredEventPhoto", "displayPhoto", "image", "photo"]) {
    const ref = raw[key];
    const rec = deref(apolloState, ref) ?? toRecord(ref);
    const url =
      getString(rec, "highResUrl") ??
      getString(rec, "source") ??
      getString(rec, "url") ??
      getString(rec, "baseUrl");
    if (url) return url;
  }
  return undefined;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) return null;
  if ("__ref" in (value as Record<string, unknown>)) return null;
  return value as Record<string, unknown>;
}

function extractEventIdFromUrl(url: string): string | undefined {
  const match = url.match(/\/events\/(\d+)/);
  return match?.[1];
}
