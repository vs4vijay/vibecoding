import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { sql } from "drizzle-orm";
import { detailedDiff } from "deep-object-diff";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TABLE_RE = /^[a-z][a-z0-9_]{0,62}$/i;

async function resolveVersion(
  storageTable: string,
  versionsTable: string,
  entityId: number,
  v: string
): Promise<{ payload: unknown; version_num: number } | null> {
  const db = getDb();
  if (v === "current") {
    const res: any = await db.execute(
      sql`SELECT payload, version_num FROM ${sql.identifier(storageTable)} WHERE id = ${entityId}`
    );
    const rows = res.rows ?? res;
    return rows[0] ?? null;
  }
  const res: any = await db.execute(
    sql`SELECT payload, version_num FROM ${sql.identifier(versionsTable)} WHERE entity_id = ${entityId} AND version_num = ${Number(v)}`
  );
  const rows = res.rows ?? res;
  return rows[0] ?? null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ storage_table: string; id: string }> }
) {
  const { storage_table, id } = await params;
  const url = new URL(req.url);
  const v1 = url.searchParams.get("v1") ?? "1";
  const v2 = url.searchParams.get("v2") ?? "current";

  if (!TABLE_RE.test(storage_table)) {
    return NextResponse.json({ error: "invalid table" }, { status: 400 });
  }
  const versionsTable = `${storage_table}_versions`;
  if (!TABLE_RE.test(versionsTable)) {
    return NextResponse.json({ error: "invalid table" }, { status: 400 });
  }

  try {
    const a = await resolveVersion(storage_table, versionsTable, Number(id), v1);
    const b = await resolveVersion(storage_table, versionsTable, Number(id), v2);
    if (!a || !b) return NextResponse.json({ error: "version not found" }, { status: 404 });
    const diff = detailedDiff(a.payload as object, b.payload as object);
    return NextResponse.json({
      v1: { label: v1, version_num: a.version_num, payload: a.payload },
      v2: { label: v2, version_num: b.version_num, payload: b.payload },
      diff,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
