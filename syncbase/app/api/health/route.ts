import { NextResponse } from "next/server";
import { getDb, getDriver } from "@/lib/db";
import { health } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const db = getDb();
    const rows = await db.select().from(health).orderBy(desc(health.id)).limit(1);
    return NextResponse.json({
      ok: true,
      db: getDriver(),
      latest: rows[0] ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
