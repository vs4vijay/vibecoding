import { SOURCES } from "./sources/registry";
import type { SourceAdapter, SourceId } from "./sources/types";

export const DISABLED_SOURCES_COOKIE = "happns.disabledSources";

/** Parse the comma-separated cookie value into a set of disabled SourceIds. */
export function parseDisabledSources(raw: string | undefined): Set<SourceId> {
  if (!raw) return new Set();
  const known = new Set<SourceId>(SOURCES.map((s) => s.id));
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is SourceId => known.has(s as SourceId));
  return new Set(ids);
}

export function serializeDisabledSources(ids: Iterable<SourceId>): string {
  return [...new Set(ids)].join(",");
}

export function filterEnabledAdapters(
  adapters: SourceAdapter[],
  disabled: Set<SourceId>,
): SourceAdapter[] {
  return adapters.filter((a) => !disabled.has(a.id));
}
