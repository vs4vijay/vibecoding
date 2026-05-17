import { NextResponse } from "next/server";
import { meetupAdapter } from "@/lib/sources/meetup";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const groupSlug = url.searchParams.get("groupSlug");
  const eventId = url.searchParams.get("eventId");

  if (!groupSlug || !eventId) {
    return NextResponse.json(
      { error: "groupSlug and eventId are required" },
      { status: 400 },
    );
  }

  try {
    const event = (await meetupAdapter.getEvent?.(groupSlug, eventId)) ?? null;
    if (!event) {
      return NextResponse.json({ event: null }, { status: 404 });
    }
    return NextResponse.json({ event });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch event" },
      { status: 502 },
    );
  }
}
