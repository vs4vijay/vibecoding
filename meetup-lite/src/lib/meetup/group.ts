import { fetchMeetupHtml } from "./client";
import { normalizeEvent } from "./event";
import {
  type ApolloState,
  extractNextData,
  findByTypename,
  getNumber,
  getString,
} from "./parse";
import type { Event, Group } from "./types";

export interface GroupPageData {
  group: Group;
  upcomingEvents: Event[];
}

export async function getGroup(urlname: string): Promise<GroupPageData | null> {
  const url = `https://www.meetup.com/${encodeURIComponent(urlname)}/`;
  const html = await fetchMeetupHtml(url);
  if (!html) return null;

  const data = extractNextData(html);
  if (!data) return null;

  const rawGroup = findGroupRecord(data.apolloState, urlname);
  if (!rawGroup) return null;

  const group = normalizeGroup(rawGroup, data.apolloState);
  const upcomingEvents = collectUpcomingEvents(
    rawGroup,
    data.apolloState,
    group.urlname,
  );

  return { group, upcomingEvents };
}

function findGroupRecord(
  apolloState: ApolloState,
  urlname: string,
): Record<string, unknown> | null {
  const candidates = findByTypename<Record<string, unknown>>(
    apolloState,
    "Group",
  );
  const match = candidates.find((g) => getString(g, "urlname") === urlname);
  return match ?? candidates[0] ?? null;
}

function normalizeGroup(
  raw: Record<string, unknown>,
  apolloState: ApolloState,
): Group {
  const stats = raw.stats as Record<string, unknown> | undefined;
  const memberCounts = stats?.memberCounts as
    | Record<string, unknown>
    | undefined;
  const memberCount = getNumber(memberCounts, "all");

  const topics = resolveTopics(raw.activeTopics, apolloState);
  const upcomingEventCount = resolveUpcomingEventCount(raw);

  return {
    urlname: getString(raw, "urlname") ?? "",
    name: getString(raw, "name") ?? "Unnamed group",
    city: getString(raw, "city"),
    country: getString(raw, "country"),
    memberCount,
    topics,
    description:
      getString(raw, "description") ?? getString(raw, "welcomeBlurb"),
    upcomingEventCount,
  };
}

function resolveTopics(value: unknown, apolloState: ApolloState): string[] {
  if (!Array.isArray(value)) return [];
  const topics: string[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const ref = (entry as Record<string, unknown>).__ref;
    if (typeof ref !== "string") continue;
    const topic = apolloState[ref];
    const name = topic?.name;
    if (typeof name === "string") topics.push(name);
  }
  return topics;
}

function resolveUpcomingEventCount(
  raw: Record<string, unknown>,
): number | undefined {
  for (const [key, value] of Object.entries(raw)) {
    if (!key.startsWith("events(") || !key.includes('"ACTIVE"')) continue;
    const total = getNumber(value as Record<string, unknown>, "totalCount");
    if (typeof total === "number") return total;
  }
  return undefined;
}

function collectUpcomingEvents(
  rawGroup: Record<string, unknown>,
  apolloState: ApolloState,
  groupSlug: string,
): Event[] {
  // Find the connection wrapper keyed with ACTIVE filter; iterate its edges.
  const refs: string[] = [];
  for (const [key, value] of Object.entries(rawGroup)) {
    if (!key.startsWith("events(") || !key.includes('"ACTIVE"')) continue;
    const conn = value as Record<string, unknown>;
    const edges = conn?.edges;
    if (!Array.isArray(edges)) continue;
    for (const edge of edges) {
      if (!edge || typeof edge !== "object") continue;
      const node = (edge as Record<string, unknown>).node;
      const ref = (node as Record<string, unknown> | undefined)?.__ref;
      if (typeof ref === "string") refs.push(ref);
    }
  }

  const seen = new Set<string>();
  const events: Event[] = [];
  for (const ref of refs) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    const raw = apolloState[ref];
    if (!raw) continue;
    // Skip skeleton series placeholders that lack a real title.
    if (typeof raw.title !== "string" || !raw.title.trim()) continue;
    try {
      const eventUrl = getString(raw, "eventUrl") ?? "";
      events.push(normalizeEvent(raw, apolloState, eventUrl, groupSlug));
    } catch {
      // ignore bad records
    }
  }
  return events.sort((a, b) => a.dateTime.localeCompare(b.dateTime));
}
