import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { sources } from "@/lib/db/schema";
import { SourceCreateSchema } from "@/lib/validation";
import { desc } from "drizzle-orm";
import {
  generateDedicatedTableDDL,
  tableNameFor,
} from "@/lib/ddl/generate";
import { applyDDLBundle, logDDLFailure } from "@/lib/ddl/apply";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const db = getDb();
  const rows = await db.select().from(sources).orderBy(desc(sources.id));
  return NextResponse.json({ sources: rows });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = SourceCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid source", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const v = parsed.data;
  const storageMode = v.storage_mode ?? "generic";
  let storageTable = v.storage_table ?? "entities";

  if (storageMode === "dedicated") {
    try {
      storageTable = tableNameFor(v.name);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
  }

  const db = getDb();
  let inserted;
  try {
    const [row] = await db
      .insert(sources)
      .values({
        name: v.name,
        enabled: v.enabled ?? true,
        http: v.http,
        pagination: v.pagination,
        recordsPath: v.records_path,
        externalIdPath: v.external_id_path,
        hashFields: v.hash_fields ?? null,
        scheduleCron: v.schedule_cron ?? null,
        storageMode,
        typedColumns: v.typed_columns ?? [],
        storageTable,
        displayColumns: v.display_columns ?? [],
        category: v.category ?? null,
        location: v.location ?? null,
        dedup: v.dedup ?? null,
        crossDedup: v.cross_dedup ?? null,
      })
      .returning();
    inserted = row;
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 409 }
    );
  }

  if (storageMode === "dedicated") {
    let statements;
    try {
      statements = generateDedicatedTableDDL(v.name, v.typed_columns ?? []);
    } catch (err) {
      // Roll back the source row — DDL generation failed.
      await db.delete(sources).where(sourcesIdEq(inserted.id));
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
    try {
      await applyDDLBundle(inserted.id, statements);
    } catch (err) {
      await logDDLFailure(inserted.id, statements, err as Error);
      await db.delete(sources).where(sourcesIdEq(inserted.id));
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  return NextResponse.json({ source: inserted }, { status: 201 });
}

import { eq } from "drizzle-orm";
function sourcesIdEq(id: number) {
  return eq(sources.id, id);
}
