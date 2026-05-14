import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { sources } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { runPipeline } from "@/lib/pipeline/run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const rows = await db.select().from(sources).where(eq(sources.id, Number(id)));
  if (rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!rows[0].enabled) return NextResponse.json({ error: "source disabled" }, { status: 409 });

  const result = await runPipeline(rows[0], "adhoc");
  return NextResponse.json(result);
}
