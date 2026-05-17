import Link from "next/link";
import { EventList } from "@/components/EventList";
import { GroupHeader } from "@/components/GroupHeader";
import { meetupAdapter } from "@/lib/sources/meetup";
import type { GroupPageData } from "@/lib/sources/types";

interface PageProps {
  params: Promise<{ groupSlug: string }>;
}

export default async function GroupPage({ params }: PageProps) {
  const { groupSlug } = await params;

  let data: GroupPageData | null = null;
  let errored = false;
  try {
    data = (await meetupAdapter.getGroup?.(groupSlug)) ?? null;
  } catch {
    errored = true;
  }

  if (!data) {
    return (
      <main className="flex-1 max-w-2xl mx-auto px-6 py-20 text-center">
        <h1 className="text-2xl font-semibold mb-3">
          {errored ? "Couldn't load this group" : "Group not found"}
        </h1>
        <p className="text-[var(--muted)] mb-8">
          {errored
            ? "Meetup didn't return a usable response. Please try again."
            : "We couldn't find a group at this URL. It may have been removed or made private."}
        </p>
        <Link
          href="/"
          className="inline-flex items-center px-4 h-10 rounded-xl bg-[var(--accent)] text-[var(--accent-foreground)] text-sm font-medium hover:bg-[var(--accent-strong)]"
        >
          Back to home
        </Link>
      </main>
    );
  }

  return (
    <main className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 py-10">
      <GroupHeader group={data.group} />
      <h2 className="text-xl font-semibold mb-5">Upcoming events</h2>
      <EventList
        events={data.upcomingEvents}
        emptyMessage="No upcoming events scheduled."
      />
    </main>
  );
}
