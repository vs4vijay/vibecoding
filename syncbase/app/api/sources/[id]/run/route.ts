import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { sources } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { runPipeline } from "@/lib/pipeline/run";
import { RunLocationSchema } from "@/lib/validation";
import { LocationRequiredError } from "@/lib/pipeline/location";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const rows = await db.select().from(sources).where(eq(sources.id, Number(id)));
  if (rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!rows[0].enabled) return NextResponse.json({ error: "source disabled" }, { status: 409 });

  let runLocation;
  if (req.headers.get("content-length") && req.headers.get("content-length") !== "0") {
    try {
      const body = await req.json();
      const parsed = RunLocationSchema.safeParse(body?.location);
      if (!parsed.success) {
        return NextResponse.json({ error: "invalid location", issues: parsed.error.issues }, { status: 400 });
      }
      runLocation = parsed.data;
    } catch {
      // empty body → ignore
    }
  }

  try {
    const result = await runPipeline(rows[0], "adhoc", runLocation);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof LocationRequiredError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    throw err;
  }
}
