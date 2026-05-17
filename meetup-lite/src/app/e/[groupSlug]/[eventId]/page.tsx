import Link from "next/link";
import { EventDetail } from "@/components/EventDetail";
import { meetupAdapter } from "@/lib/sources/meetup";
import type { Event } from "@/lib/sources/types";

interface PageProps {
  params: Promise<{ groupSlug: string; eventId: string }>;
}

export default async function EventPage({ params }: PageProps) {
  const { groupSlug, eventId } = await params;

  let event: Event | null = null;
  let errored = false;
  try {
    event = (await meetupAdapter.getEvent?.(groupSlug, eventId)) ?? null;
  } catch {
    errored = true;
  }

  if (!event) {
    return (
      <main className="flex-1 max-w-2xl mx-auto px-6 py-20 text-center">
        <h1 className="text-2xl font-semibold mb-3">
          {errored ? "Couldn't load this event" : "Event not found"}
        </h1>
        <p className="text-[var(--muted)] mb-8">
          {errored
            ? "Meetup didn't return a usable response. Please try again in a moment."
            : "We couldn't find an event at this URL. It may have been removed or made private."}
        </p>
        <Link
          href="/"
          className="inline-flex items-center px-4 h-10 rounded-xl bg-[var(--accent)] text-[var(--accent-foreground)] text-sm font-medium hover:bg-[var(--accent-strong)] transition"
        >
          Back to home
        </Link>
      </main>
    );
  }

  return (
    <main className="flex-1">
      <EventDetail event={event} />
    </main>
  );
}
