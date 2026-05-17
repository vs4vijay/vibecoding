import { EventCard } from "./EventCard";
import type { Event } from "@/lib/sources/types";

interface EventListProps {
  events: Event[];
  emptyMessage?: string;
}

export function EventList({ events, emptyMessage }: EventListProps) {
  if (events.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--border-strong)] py-16 px-6 text-center text-[var(--muted)]">
        {emptyMessage ?? "No events found."}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-5">
      {events.map((event) => (
        <EventCard key={`${event.group.urlname}:${event.id}`} event={event} />
      ))}
    </div>
  );
}
