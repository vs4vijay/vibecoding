import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { models } from "@/lib/db/schema";
import { ensureSchema } from "@/lib/db/bootstrap";
import { enqueueJob } from "@/lib/queue/enqueue";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSchema();
  const d = db();
  const rows = await d.select().from(models).orderBy(desc(models.createdAt)).limit(50);
  return NextResponse.json({ models: rows });
}

export async function POST(req: Request) {
  await ensureSchema();
  const body = (await req.json()) as {
    cohort_ids: string[];
    modalities?: string[];
    horizons_years?: number[];
    ensemble_size?: number;
    seed?: number;
    harmonisation_run_id?: string;
  };
  if (!body.cohort_ids || body.cohort_ids.length === 0) {
    return NextResponse.json({ error: "cohort_ids required" }, { status: 400 });
  }
  const { id } = await enqueueJob({
    kind: "train",
    payload: {
      cohort_ids: body.cohort_ids,
      modalities: body.modalities ?? ["mri", "biochem", "cognitive"],
      horizons_years: body.horizons_years ?? [1, 3, 5],
      ensemble_size: body.ensemble_size ?? 3,
      seed: body.seed ?? 42,
      harmonisation_run_id: body.harmonisation_run_id,
    },
  });
  return NextResponse.json({ job_id: id }, { status: 202 });
}
