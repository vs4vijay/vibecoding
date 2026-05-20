import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { audits } from "@/lib/db/schema";
import { ensureSchema } from "@/lib/db/bootstrap";
import { enqueueJob } from "@/lib/queue/enqueue";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await ensureSchema();
  const { id } = await params;
  const d = db();
  const rows = await d.select().from(audits).where(eq(audits.modelId, id)).orderBy(desc(audits.createdAt)).limit(1);
  return NextResponse.json({ audit: rows[0] ?? null });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await ensureSchema();
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    cohort_ids?: string[];
    seed?: number;
  };
  const { id: jobId } = await enqueueJob({
    kind: "audit",
    payload: {
      model_id: id,
      cohort_ids: body.cohort_ids,
      seed: body.seed,
    },
  });
  return NextResponse.json({ job_id: jobId }, { status: 202 });
}
