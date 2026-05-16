import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { changeLog } from "@/lib/db/schema";
import { desc, eq, and, gte, SQL } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const source = url.searchParams.get("source");
  const since = url.searchParams.get("since");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100", 10) || 100, 500);

  const filters: SQL[] = [];
  if (source) filters.push(eq(changeLog.source, source));
  if (since) filters.push(gte(changeLog.changedAt, new Date(since)));

  const db = getDb();
  const rows =
    filters.length > 0
      ? await db
          .select()
          .from(changeLog)
          .where(filters.length === 1 ? filters[0] : and(...filters))
          .orderBy(desc(changeLog.id))
          .limit(limit)
      : await db.select().from(changeLog).orderBy(desc(changeLog.id)).limit(limit);
  return NextResponse.json({ changes: rows });
}
