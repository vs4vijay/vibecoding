import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { sources } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getScheduler } from "@/lib/scheduler";
import { generateDropDedicatedDDL } from "@/lib/ddl/generate";
import { applyDDLBundle, logDDLFailure } from "@/lib/ddl/apply";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const rows = await db.select().from(sources).where(eq(sources.id, Number(id)));
  if (rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ source: rows[0] });
}

const PatchSchema = z.object({
  enabled: z.boolean().optional(),
  schedule_cron: z.string().nullable().optional(),
  hash_fields: z.array(z.string()).nullable().optional(),
  http: z.any().optional(),
  pagination: z.any().optional(),
  records_path: z.string().optional(),
  external_id_path: z.string().optional(),
  storage_mode: z.enum(["generic", "dedicated"]).optional(),
  display_columns: z
    .array(
      z.object({
        label: z.string().min(1),
        jsonpath: z.string().min(1),
        primary: z.boolean().optional(),
      })
    )
    .optional(),
  category: z.string().min(1).max(64).nullable().optional(),
  location: z.any().nullable().optional(),
  dedup: z.any().nullable().optional(),
  cross_dedup: z.any().nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid patch", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const db = getDb();
  const [current] = await db.select().from(sources).where(eq(sources.id, Number(id)));
  if (!current) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (parsed.data.storage_mode && parsed.data.storage_mode !== current.storageMode) {
    return NextResponse.json(
      { error: "storage_mode cannot be changed after creation" },
      { status: 409 }
    );
  }

  const next: any = { updatedAt: new Date() };
  if (parsed.data.enabled !== undefined) next.enabled = parsed.data.enabled;
  if (parsed.data.schedule_cron !== undefined) next.scheduleCron = parsed.data.schedule_cron;
  if (parsed.data.hash_fields !== undefined) next.hashFields = parsed.data.hash_fields;
  if (parsed.data.http !== undefined) next.http = parsed.data.http;
  if (parsed.data.pagination !== undefined) next.pagination = parsed.data.pagination;
  if (parsed.data.records_path !== undefined) next.recordsPath = parsed.data.records_path;
  if (parsed.data.external_id_path !== undefined) next.externalIdPath = parsed.data.external_id_path;
  if (parsed.data.display_columns !== undefined) next.displayColumns = parsed.data.display_columns;
  if (parsed.data.category !== undefined) next.category = parsed.data.category;
  if (parsed.data.location !== undefined) next.location = parsed.data.location;
  if (parsed.data.dedup !== undefined) next.dedup = parsed.data.dedup;
  if (parsed.data.cross_dedup !== undefined) next.crossDedup = parsed.data.cross_dedup;

  const [updated] = await db
    .update(sources)
    .set(next)
    .where(eq(sources.id, Number(id)))
    .returning();

  const scheduler = getScheduler();
  const shouldBeRegistered = updated.enabled && !!updated.scheduleCron;
  if (shouldBeRegistered) {
    await scheduler.register(updated.name, updated.scheduleCron!);
  } else {
    await scheduler.unregister(updated.name);
  }

  return NextResponse.json({ source: updated });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const hard = url.searchParams.get("hard") === "true";

  const db = getDb();
  const [current] = await db.select().from(sources).where(eq(sources.id, Number(id)));
  if (!current) return NextResponse.json({ error: "not found" }, { status: 404 });

  const scheduler = getScheduler();
  await scheduler.unregister(current.name);

  if (!hard) {
    const [updated] = await db
      .update(sources)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(sources.id, Number(id)))
      .returning();
    return NextResponse.json({ source: updated, deleted: "soft" });
  }

  // Hard delete: drop dedicated tables if applicable, then delete the row.
  if (current.storageMode === "dedicated") {
    const statements = generateDropDedicatedDDL(current.name);
    try {
      await applyDDLBundle(current.id, statements);
    } catch (err) {
      await logDDLFailure(current.id, statements, err as Error);
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }
  await db.delete(sources).where(eq(sources.id, Number(id)));
  return NextResponse.json({ deleted: "hard", source: current });
}
