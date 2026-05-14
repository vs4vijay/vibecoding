import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ddlLog } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100", 10) || 100, 500);
  const db = getDb();
  const rows = await db.select().from(ddlLog).orderBy(desc(ddlLog.id)).limit(limit);
  return NextResponse.json({ ddl_log: rows });
}
