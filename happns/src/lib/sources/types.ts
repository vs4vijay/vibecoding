/**
 * Shared types across all event sources (Meetup, Luma, GDG, HasGeek, …).
 *
 * Each source is a separate adapter under src/lib/sources/<source>/. The app
 * never talks to a source's HTML or HTTP layer directly — it goes through
 * `SourceAdapter`.
 */

export type SourceId = "meetup" | "luma" | "gdg" | "hasgeek";

export interface Venue {
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
}

export interface Host {
  name: string;
  memberId?: string;
  /** Source-specific profile/host URL when available. */
  url?: string;
}

export interface Group {
  urlname: string;
  name: string;
  city?: string;
  country?: string;
  memberCount?: number;
  topics?: string[];
  description?: string;
  upcomingEventCount?: number;
}

export interface Event {
  /** Which source this event came from. */
  source: SourceId;
  /** Source-native event id (e.g. meetup numeric id, luma slug, gdg event id). */
  id: string;
  title: string;
  dateTime: string; // ISO string
  endTime?: string;
  /** Canonical URL on the source's own site. */
  eventUrl: string;
  /**
   * App-internal route for the event detail page (e.g. /e/<slug>/<id>).
   * When absent, the card opens `eventUrl` in a new tab — used for sources
   * we haven't built dedicated detail pages for yet.
   */
  detailHref?: string;
  description?: string;
  going?: number;
  venue?: Venue;
  /** Host group / calendar / chapter, in source-neutral form. */
  group: Pick<Group, "urlname" | "name" | "city" | "country">;
  hosts?: Host[];
  imageUrl?: string;
  isOnline?: boolean;
  eventType?: string;
}

export interface GroupPageData {
  group: Group;
  upcomingEvents: Event[];
}

export interface SearchQuery {
  location: string;
  /** Source-specific keywords/categories. Adapters decide how to interpret. */
  keywords?: string[];
}

/**
 * Each source implements this. Methods that don't make sense for a given
 * source can be omitted (e.g. a source with no concept of a "group" omits
 * `getGroup`).
 */
export interface SourceAdapter {
  id: SourceId;
  label: string;
  /** Short user-facing tagline shown in the Settings page. */
  description: string;
  /** Returns matching events for the query. Never throws — empty array on failure. */
  searchEvents(query: SearchQuery): Promise<Event[]>;
  /** Loads a single event's full detail. Returns null if not found. */
  getEvent?(slug: string, eventId: string): Promise<Event | null>;
  /** Loads a group / calendar / chapter detail page. */
  getGroup?(slug: string): Promise<GroupPageData | null>;
}
