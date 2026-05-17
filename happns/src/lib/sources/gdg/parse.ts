import { parse } from "node-html-parser";

export interface GdgLdEvent {
  name: string;
  startDate: string;
  endDate?: string;
  description?: string;
  image?: string;
  url?: string;
  attendanceMode?: string;
  location?: {
    name?: string;
    address?: {
      streetAddress?: string;
      addressLocality?: string;
      addressRegion?: string;
      addressCountry?: string;
      postalCode?: string;
    };
  };
  organizer?: { name?: string; url?: string };
}

/**
 * Each GDG event detail page embeds a `<script type="application/ld+json">`
 * with `@type: "Event"` containing the canonical data (start_date, location,
 * etc.). Page chrome is JS-rendered, but this script is server-side, so it's
 * the reliable extraction target.
 */
export function extractGdgEventLd(html: string): GdgLdEvent | null {
  const root = parse(html);
  const scripts = root.querySelectorAll('script[type="application/ld+json"]');
  for (const s of scripts) {
    try {
      const data = JSON.parse(s.text);
      const ev = pickEvent(data);
      if (ev) return ev;
    } catch {
      // Some pages ship multiple LD blocks; tolerate a malformed one and
      // keep scanning the rest.
    }
  }
  return null;
}

function pickEvent(data: unknown): GdgLdEvent | null {
  if (!data || typeof data !== "object") return null;
  if (Array.isArray(data)) {
    for (const item of data) {
      const ev = pickEvent(item);
      if (ev) return ev;
    }
    return null;
  }
  const obj = data as Record<string, unknown>;
  if (
    obj["@type"] === "Event" &&
    typeof obj.name === "string" &&
    typeof obj.startDate === "string"
  ) {
    return obj as unknown as GdgLdEvent;
  }
  return null;
}
