import { parse } from "node-html-parser";

export interface LumaNextData {
  pageProps: Record<string, unknown>;
}

/**
 * Extracts the `<script id="__NEXT_DATA__">` payload that Luma's Next.js
 * SSR embeds in every page. Returns null when the structure isn't found.
 */
export function extractLumaNextData(html: string): LumaNextData | null {
  const root = parse(html);
  const node = root.querySelector("script#__NEXT_DATA__");
  if (!node) return null;
  try {
    const json = JSON.parse(node.text) as {
      props?: { pageProps?: Record<string, unknown> };
    };
    return { pageProps: json.props?.pageProps ?? {} };
  } catch {
    return null;
  }
}

/**
 * Walk the typical Luma cache paths to find the events array. City and topic
 * pages put events under `pageProps.initialData.data.events`. We probe a few
 * other shapes defensively in case Luma reshuffles the cache.
 */
export function findLumaEvents(
  pageProps: Record<string, unknown>,
): LumaEventRecord[] {
  const candidates: unknown[] = [];

  const visit = (value: unknown, depth: number) => {
    if (depth > 5 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      if (value[0] && typeof value[0] === "object" && "event" in value[0]) {
        candidates.push(value);
      }
      return;
    }
    for (const v of Object.values(value as Record<string, unknown>)) {
      visit(v, depth + 1);
    }
  };
  visit(pageProps, 0);

  // Prefer the longest array — usually the primary listing.
  const arr = candidates.sort((a, b) => {
    const al = Array.isArray(a) ? a.length : 0;
    const bl = Array.isArray(b) ? b.length : 0;
    return bl - al;
  })[0];
  return (arr as LumaEventRecord[]) ?? [];
}

/** Shape of a single record in `pageProps.initialData.data.events`. */
export interface LumaEventRecord {
  api_id?: string;
  event?: LumaEventInner;
  cover_image?: { url?: string } | null;
  start_at?: string;
  hosts?: LumaHost[];
  guest_count?: number;
}

export interface LumaEventInner {
  api_id?: string;
  name?: string;
  url?: string; // slug, e.g. "70xs1fc2"
  start_at?: string;
  end_at?: string;
  timezone?: string;
  cover_url?: string;
  social_image_url?: string;
  location_type?: string; // "offline" | "online" | ...
  event_type?: string;
  virtual_info?: { url?: string } | null;
  geo_address_info?: LumaGeoAddress | null;
  calendar_api_id?: string;
}

export interface LumaGeoAddress {
  mode?: string;
  city?: string;
  city_state?: string;
  region?: string;
  country?: string;
  sublocality?: string;
  address?: string;
}

export interface LumaHost {
  api_id?: string;
  name?: string;
  website?: string;
}
