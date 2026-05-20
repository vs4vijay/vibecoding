import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { participants } from "@/lib/db/schema";
import { ensureSchema } from "@/lib/db/bootstrap";
import { enqueueJob } from "@/lib/queue/enqueue";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await ensureSchema();
  const { id } = await params;
  const d = db();
  const found = await d.select({ id: participants.id }).from(participants).where(eq(participants.id, id)).limit(1);
  if (found.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as {
    horizons_years?: number[];
    seed?: number;
    model_id?: string;
  };
  const { id: jobId } = await enqueueJob({
    kind: "predict",
    payload: {
      participant_id: id,
      horizons_years: body.horizons_years ?? [1, 3, 5],
      seed: body.seed,
      model_id: body.model_id,
    },
  });
  return NextResponse.json({ job_id: jobId }, { status: 202 });
}
