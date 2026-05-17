import { gdgAdapter } from "./gdg";
import { hasgeekAdapter } from "./hasgeek";
import { lumaAdapter } from "./luma";
import { meetupAdapter } from "./meetup";
import type {
  Event,
  SearchQuery,
  SourceAdapter,
  SourceId,
} from "./types";

/**
 * Every source the app knows about. Order here is the default display order.
 * Adding a new source = add one import + push the adapter into this array.
 */
export const SOURCES: SourceAdapter[] = [
  meetupAdapter,
  lumaAdapter,
  gdgAdapter,
  hasgeekAdapter,
];

const BY_ID = new Map<SourceId, SourceAdapter>(
  SOURCES.map((s) => [s.id, s]),
);

export function getAdapter(id: SourceId): SourceAdapter | undefined {
  return BY_ID.get(id);
}

export function getEnabledAdapters(enabledIds: SourceId[]): SourceAdapter[] {
  return enabledIds
    .map((id) => BY_ID.get(id))
    .filter((a): a is SourceAdapter => Boolean(a));
}

export interface MultiSearchResult {
  events: Event[];
  /** Per-source counts so the UI can show provenance. */
  perSource: Record<SourceId, number>;
  /** Sources that crashed (we surfaced empty results for these). */
  failed: SourceId[];
}

/**
 * Run `searchEvents` on every supplied adapter in parallel via Promise.allSettled
 * (so one source's failure doesn't sink the rest), dedupe by `source:id`, and
 * sort by dateTime ascending.
 */
export async function searchAcrossSources(
  adapters: SourceAdapter[],
  query: SearchQuery,
): Promise<MultiSearchResult> {
  const results = await Promise.allSettled(
    adapters.map((a) => a.searchEvents(query)),
  );

  const perSource = {} as Record<SourceId, number>;
  const failed: SourceId[] = [];
  const seen = new Set<string>();
  const merged: Event[] = [];

  results.forEach((r, i) => {
    const adapter = adapters[i];
    if (r.status === "rejected") {
      failed.push(adapter.id);
      perSource[adapter.id] = 0;
      return;
    }
    perSource[adapter.id] = r.value.length;
    for (const e of r.value) {
      const key = `${e.source}:${e.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(e);
    }
  });

  merged.sort((a, b) => a.dateTime.localeCompare(b.dateTime));
  return { events: merged, perSource, failed };
}
