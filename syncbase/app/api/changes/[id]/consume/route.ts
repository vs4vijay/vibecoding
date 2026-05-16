import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { changeLog } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const [row] = await db
    .update(changeLog)
    .set({ consumedAt: new Date() })
    .where(eq(changeLog.id, Number(id)))
    .returning();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ change: row });
}
