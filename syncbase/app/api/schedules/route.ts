import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { sources, runs } from "@/lib/db/schema";
import { desc, eq, isNotNull } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const db = getDb();
  const scheduled = await db
    .select()
    .from(sources)
    .where(isNotNull(sources.scheduleCron));

  const enriched = await Promise.all(
    scheduled.map(async (s) => {
      const lastRun = await db
        .select()
        .from(runs)
        .where(eq(runs.sourceId, s.id))
        .orderBy(desc(runs.id))
        .limit(1);
      return {
        id: s.id,
        name: s.name,
        enabled: s.enabled,
        schedule_cron: s.scheduleCron,
        last_run: lastRun[0] ?? null,
      };
    })
  );

  return NextResponse.json({ schedules: enriched });
}
