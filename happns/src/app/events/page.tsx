import { cookies } from "next/headers";
import { CategoryFilter } from "@/components/CategoryFilter";
import { DateFilter } from "@/components/DateFilter";
import { EventList } from "@/components/EventList";
import { LocationSearch } from "@/components/LocationSearch";
import { RememberLocation } from "@/components/RememberLocation";
import {
  DISABLED_SOURCES_COOKIE,
  filterEnabledAdapters,
  parseDisabledSources,
} from "@/lib/sourcePrefs";
import { DEFAULT_CATEGORY_IDS, parseCategoryIds } from "@/lib/sources/meetup";
import { SOURCES, searchAcrossSources } from "@/lib/sources/registry";
import type { SourceId } from "@/lib/sources/types";
import {
  DEFAULT_TIME_WINDOW,
  filterByTimeWindow,
  parseTimeWindow,
} from "@/lib/timeWindow";

interface PageProps {
  searchParams: Promise<{
    location?: string;
    categories?: string | string[];
    when?: string | string[];
  }>;
}

export default async function EventsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const location = (params.location ?? "").trim();
  const categoryIds =
    parseCategoryIds(params.categories) ?? [...DEFAULT_CATEGORY_IDS];
  const timeWindow = parseTimeWindow(params.when) ?? DEFAULT_TIME_WINDOW;

  const cookieStore = await cookies();
  const disabled = parseDisabledSources(
    cookieStore.get(DISABLED_SOURCES_COOKIE)?.value,
  );
  const enabledAdapters = filterEnabledAdapters(SOURCES, disabled);

  let events: Awaited<ReturnType<typeof searchAcrossSources>>["events"] = [];
  let perSource: Partial<Record<SourceId, number>> = {};
  let failed: SourceId[] = [];
  if (location && enabledAdapters.length > 0) {
    const result = await searchAcrossSources(enabledAdapters, {
      location,
      keywords: categoryIds,
    });
    events = filterByTimeWindow(result.events, timeWindow);
    perSource = result.perSource;
    failed = result.failed;
  }

  return (
    <main className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 py-10">
      {location ? <RememberLocation location={location} /> : null}
      <div className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-1">
          {location ? (
            <>
              Events near{" "}
              <span className="text-[var(--accent-strong)]">
                &ldquo;{location}&rdquo;
              </span>
            </>
          ) : (
            "Discover events"
          )}
        </h1>
        <p className="text-[var(--muted)] mb-6">
          {location ? (
            <ResultSummary
              total={events.length}
              perSource={perSource}
              failed={failed}
            />
          ) : (
            "Pick a city to start browsing."
          )}
        </p>
        <div className="max-w-2xl">
          <LocationSearch
            defaultValue={location}
            preserveCategories={categoryIds}
            preserveWhen={timeWindow}
          />
        </div>
      </div>

      {location ? (
        <div className="grid lg:grid-cols-[260px_1fr] gap-6">
          <aside className="lg:sticky lg:top-20 lg:self-start">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 space-y-6">
              <DateFilter
                location={location}
                categories={categoryIds}
                selected={timeWindow}
              />
              <div className="border-t border-[var(--border)]" />
              <CategoryFilter
                location={location}
                selected={categoryIds}
                when={timeWindow}
              />
            </div>
          </aside>
          <div>
            <EventList
              events={events}
              emptyMessage={buildEmptyMessage(
                location,
                categoryIds.length > 0,
                timeWindow !== "any",
              )}
            />
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-[var(--border-strong)] py-16 px-6 text-center text-[var(--muted)]">
          Enter a city above to find events across Meetup, Luma and more.
        </div>
      )}
    </main>
  );
}

interface ResultSummaryProps {
  total: number;
  perSource: Partial<Record<SourceId, number>>;
  failed: SourceId[];
}

function ResultSummary({ total, perSource, failed }: ResultSummaryProps) {
  const parts: string[] = [];
  for (const [id, count] of Object.entries(perSource)) {
    if (!count) continue;
    const adapter = SOURCES.find((s) => s.id === id);
    if (!adapter) continue;
    parts.push(`${count} ${adapter.label}`);
  }
  return (
    <>
      {total} {total === 1 ? "result" : "results"}
      {parts.length > 0 ? <> &middot; {parts.join(" · ")}</> : null}
      {failed.length > 0 ? (
        <span className="text-amber-600 dark:text-amber-400">
          {" "}
          (couldn&apos;t reach: {failed.join(", ")})
        </span>
      ) : null}
    </>
  );
}

function buildEmptyMessage(
  location: string,
  hasCategories: boolean,
  hasTime: boolean,
): string {
  const filters = [
    hasCategories ? "the selected categories" : null,
    hasTime ? "the chosen time window" : null,
  ].filter(Boolean);
  if (filters.length === 0) {
    return `No upcoming events found near "${location}".`;
  }
  return `No events near "${location}" match ${filters.join(" and ")}.`;
}
