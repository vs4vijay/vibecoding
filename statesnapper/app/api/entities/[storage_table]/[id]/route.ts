import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TABLE_RE = /^[a-z][a-z0-9_]{0,62}$/i;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ storage_table: string; id: string }> }
) {
  const { storage_table, id } = await params;
  if (!TABLE_RE.test(storage_table)) {
    return NextResponse.json({ error: "invalid table" }, { status: 400 });
  }
  const db = getDb();
  try {
    const res: any = await db.execute(
      sql`SELECT * FROM ${sql.identifier(storage_table)} WHERE id = ${Number(id)}`
    );
    const rows = res.rows ?? res;
    if (!rows.length) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ entity: rows[0] });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
