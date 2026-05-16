import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { sources } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getScheduler } from "@/lib/scheduler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PatchSchema = z.object({
  enabled: z.boolean().optional(),
  schedule_cron: z.string().nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ source_id: string }> }
) {
  const { source_id } = await params;
  const body = await req.json();
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid patch", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const db = getDb();
  const [current] = await db.select().from(sources).where(eq(sources.id, Number(source_id)));
  if (!current) return NextResponse.json({ error: "not found" }, { status: 404 });

  const next: any = { updatedAt: new Date() };
  if (parsed.data.enabled !== undefined) next.enabled = parsed.data.enabled;
  if (parsed.data.schedule_cron !== undefined) next.scheduleCron = parsed.data.schedule_cron;

  const [updated] = await db
    .update(sources)
    .set(next)
    .where(eq(sources.id, Number(source_id)))
    .returning();

  const scheduler = getScheduler();
  if (updated.enabled && updated.scheduleCron) {
    await scheduler.register(updated.name, updated.scheduleCron);
  } else {
    await scheduler.unregister(updated.name);
  }

  return NextResponse.json({ source: updated });
}
