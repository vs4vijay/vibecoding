import { CategoryFilter } from "@/components/CategoryFilter";
import { DateFilter } from "@/components/DateFilter";
import { EventList } from "@/components/EventList";
import { LocationSearch } from "@/components/LocationSearch";
import { parseCategoryIds } from "@/lib/meetup/categories";
import { searchEventsByCategories } from "@/lib/meetup/search";
import { filterByTimeWindow, parseTimeWindow } from "@/lib/meetup/timeWindow";

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
  const categoryIds = parseCategoryIds(params.categories);
  const timeWindow = parseTimeWindow(params.when);

  let events: Awaited<ReturnType<typeof searchEventsByCategories>> = [];
  let errored = false;
  if (location) {
    try {
      const all = await searchEventsByCategories(location, categoryIds);
      events = filterByTimeWindow(all, timeWindow);
    } catch {
      errored = true;
    }
  }

  return (
    <main className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 py-10">
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
          {location
            ? `${events.length} ${events.length === 1 ? "result" : "results"} from meetup.com`
            : "Pick a city to start browsing."}
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
            {errored ? (
              <EmptyState>
                Couldn&apos;t load events from meetup.com. Please try again.
              </EmptyState>
            ) : (
              <EventList
                events={events}
                emptyMessage={buildEmptyMessage(
                  location,
                  categoryIds.length > 0,
                  timeWindow !== "any",
                )}
              />
            )}
          </div>
        </div>
      ) : (
        <EmptyState>Enter a city above to find Meetup events.</EmptyState>
      )}
    </main>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--border-strong)] py-16 px-6 text-center text-[var(--muted)]">
      {children}
    </div>
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
