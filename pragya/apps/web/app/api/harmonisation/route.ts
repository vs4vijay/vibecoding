import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { harmonisationRuns } from "@/lib/db/schema";
import { ensureSchema } from "@/lib/db/bootstrap";
import { enqueueJob } from "@/lib/queue/enqueue";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSchema();
  const d = db();
  const rows = await d.select().from(harmonisationRuns).orderBy(desc(harmonisationRuns.startedAt)).limit(50);
  return NextResponse.json({ runs: rows });
}

export async function POST(req: Request) {
  await ensureSchema();
  const body = (await req.json()) as {
    cohort_ids: string[];
    modalities?: string[];
    seed?: number;
  };
  if (!body.cohort_ids || body.cohort_ids.length < 2) {
    return NextResponse.json({ error: "need >=2 cohort_ids" }, { status: 400 });
  }
  const { id } = await enqueueJob({
    kind: "harmonise",
    payload: {
      cohort_ids: body.cohort_ids,
      modalities: body.modalities ?? ["mri", "biochem"],
      seed: body.seed,
    },
  });
  return NextResponse.json({ job_id: id }, { status: 202 });
}
