import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { runs } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const sourceId = url.searchParams.get("source_id");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 500);
  const db = getDb();
  const base = db.select().from(runs).orderBy(desc(runs.id)).limit(limit);
  const rows = sourceId
    ? await db.select().from(runs).where(eq(runs.sourceId, Number(sourceId))).orderBy(desc(runs.id)).limit(limit)
    : await base;
  return NextResponse.json({ runs: rows });
}
