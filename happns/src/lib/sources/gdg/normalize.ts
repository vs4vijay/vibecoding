import type { Event } from "../types";
import type { GdgLdEvent } from "./parse";

export function normalizeGdgEvent(
  ld: GdgLdEvent,
  eventUrl: string,
  slug: string,
): Event | null {
  if (!ld.startDate) return null;

  const chapter = chapterFromSlug(slug);
  const locality =
    ld.location?.address?.addressLocality?.trim() || undefined;
  const region = ld.location?.address?.addressRegion?.trim() || undefined;
  const country = ld.location?.address?.addressCountry?.trim() || undefined;
  const isOnline =
    (ld.attendanceMode ?? "").toLowerCase().includes("online") ||
    !locality;

  return {
    source: "gdg",
    id: slug,
    title: cleanTitle(ld.name),
    dateTime: ld.startDate,
    endTime: ld.endDate,
    eventUrl,
    detailHref: undefined,
    description: ld.description?.trim() || undefined,
    venue: isOnline
      ? undefined
      : {
          name: ld.location?.name?.trim() || undefined,
          address: ld.location?.address?.streetAddress?.trim() || undefined,
          city: locality,
          state: region,
          country,
        },
    group: {
      urlname: chapter.slug,
      name: chapter.displayName,
      city: locality,
      country,
    },
    imageUrl: ld.image,
    isOnline,
  };
}

function cleanTitle(title: string): string {
  return title
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract the chapter slug from a Bevy event detail slug. The pattern is
 * `google-gdg-<chapter>-presents-...`, where chapter may itself contain
 * hyphens (e.g. `cloud-bangalore`, `central-florida`). Defensively, we
 * split on `-presents-` and strip the `google-` prefix.
 */
function chapterFromSlug(slug: string): { slug: string; displayName: string } {
  const idx = slug.indexOf("-presents-");
  if (idx < 0) return { slug: "", displayName: "GDG" };
  let head = slug.slice(0, idx);
  if (head.startsWith("google-")) head = head.slice("google-".length);
  return {
    slug: head,
    displayName: prettyName(head),
  };
}

function prettyName(slug: string): string {
  return slug
    .split("-")
    .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p))
    .join(" ");
}
