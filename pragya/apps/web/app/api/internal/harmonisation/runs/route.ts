import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/client";
import { harmonisationRuns, harmonisedFeatures } from "@/lib/db/schema";
import { ensureSchema } from "@/lib/db/bootstrap";
import { checkInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

type Body = {
  cohort_ids: string[];
  modalities: string[];
  params: Record<string, unknown>;
  before_means: Record<string, Record<string, number>>;
  after_means: Record<string, Record<string, number>>;
  harmonised_rows: Array<{ visit_id: string; modality: string; payload: Record<string, number> }>;
};

export async function POST(req: Request) {
  const auth = checkInternalAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 401 });
  await ensureSchema();
  const body = (await req.json()) as Body;
  const d = db();
  const runId = `harm-${randomUUID()}`;
  await d.insert(harmonisationRuns).values({
    id: runId,
    cohortIds: body.cohort_ids,
    modalities: body.modalities,
    params: body.params,
    beforeMeans: body.before_means,
    afterMeans: body.after_means,
    status: "succeeded",
    startedAt: new Date(),
    finishedAt: new Date(),
  });
  const rows = body.harmonised_rows.map((r) => ({
    id: `harmf-${randomUUID()}`,
    runId,
    visitId: r.visit_id,
    modality: r.modality,
    payload: r.payload,
  }));
  // Chunk inserts.
  for (let i = 0; i < rows.length; i += 500) {
    await d.insert(harmonisedFeatures).values(rows.slice(i, i + 500));
  }
  return NextResponse.json({ run_id: runId, feature_rows: rows.length });
}
