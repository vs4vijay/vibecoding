import type { Event, Host, Venue } from "../types";
import type { LumaEventRecord, LumaGeoAddress } from "./parse";

const EVENT_URL_BASE = "https://luma.com/";

export function normalizeLumaEvent(record: LumaEventRecord): Event | null {
  const inner = record.event;
  if (!inner) return null;

  const id = inner.api_id ?? record.api_id ?? "";
  const name = inner.name?.trim();
  if (!id || !name) return null;

  const startAt = inner.start_at ?? record.start_at;
  if (!startAt) return null;

  const slug = inner.url ?? id;
  const eventUrl = `${EVENT_URL_BASE}${slug}`;

  const isOnline =
    (inner.location_type ?? "").toLowerCase() === "online" ||
    Boolean(inner.virtual_info?.url);

  const venue = resolveVenue(inner.geo_address_info ?? null, isOnline);
  const groupSlug = inner.calendar_api_id ?? "";
  const groupName = record.hosts?.[0]?.name ?? "Luma";

  return {
    source: "luma",
    id,
    title: name,
    dateTime: startAt,
    endTime: inner.end_at,
    eventUrl,
    // No internal detail page for Luma yet → card opens eventUrl in a new tab.
    detailHref: undefined,
    going:
      typeof record.guest_count === "number" ? record.guest_count : undefined,
    venue,
    group: {
      urlname: groupSlug,
      name: groupName,
      city: venue?.city,
      country: venue?.country,
    },
    hosts: resolveHosts(record.hosts),
    imageUrl: inner.cover_url ?? inner.social_image_url,
    isOnline,
    eventType: inner.event_type,
  };
}

function resolveVenue(
  geo: LumaGeoAddress | null,
  isOnline: boolean,
): Venue | undefined {
  if (isOnline || !geo) return undefined;
  const name = nonEmpty(geo.sublocality) ?? nonEmpty(geo.city);
  return {
    name,
    address: nonEmpty(geo.address),
    city: nonEmpty(geo.city),
    state: nonEmpty(geo.region),
    country: nonEmpty(geo.country),
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.trim() ? value : undefined;
}

function resolveHosts(hosts: LumaEventRecord["hosts"]): Host[] {
  if (!Array.isArray(hosts)) return [];
  const out: Host[] = [];
  for (const h of hosts) {
    if (!h?.name) continue;
    out.push({
      name: h.name,
      memberId: h.api_id,
      url: h.website,
    });
  }
  return out;
}

