import { NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  biochemFeatures,
  cognitiveAssessments,
  mriFeatures,
  octFeatures,
  participants,
  visits,
} from "@/lib/db/schema";
import { ensureSchema } from "@/lib/db/bootstrap";
import { checkInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

type Body = {
  cohort_ids: string[];
  modalities: string[];
};

export async function POST(req: Request) {
  const auth = checkInternalAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 401 });
  await ensureSchema();
  const body = (await req.json()) as Body;
  const d = db();

  const ppl = await d
    .select({ id: participants.id, cohortId: participants.cohortId })
    .from(participants)
    .where(inArray(participants.cohortId, body.cohort_ids));
  const participantById = new Map(ppl.map((p) => [p.id, p.cohortId]));
  if (ppl.length === 0) return NextResponse.json({ rows: [] });

  const vs = await d
    .select()
    .from(visits)
    .where(inArray(visits.participantId, ppl.map((p) => p.id)));
  const visitIds = vs.map((v) => v.id);

  const featureMaps: Record<string, Map<string, any>> = {};
  if (body.modalities.includes("cognitive")) {
    const rows = await d.select().from(cognitiveAssessments).where(inArray(cognitiveAssessments.visitId, visitIds));
    featureMaps.cognitive = new Map(rows.map((r) => [r.visitId, r]));
  }
  if (body.modalities.includes("mri")) {
    const rows = await d.select().from(mriFeatures).where(inArray(mriFeatures.visitId, visitIds));
    featureMaps.mri = new Map(rows.map((r) => [r.visitId, r]));
  }
  if (body.modalities.includes("oct")) {
    const rows = await d.select().from(octFeatures).where(inArray(octFeatures.visitId, visitIds));
    featureMaps.oct = new Map(rows.map((r) => [r.visitId, r]));
  }
  if (body.modalities.includes("biochem")) {
    const rows = await d.select().from(biochemFeatures).where(inArray(biochemFeatures.visitId, visitIds));
    featureMaps.biochem = new Map(rows.map((r) => [r.visitId, r]));
  }

  function toModality(modality: string, raw: any): Record<string, number> {
    if (!raw) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (k === "id" || k === "visitId") continue;
      if (typeof v === "number") {
        const snake = k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
        out[snake] = v;
      }
    }
    return out;
  }

  const rows = vs.map((v) => ({
    visit_id: v.id,
    cohort_id: participantById.get(v.participantId) ?? "",
    features: Object.fromEntries(
      body.modalities.map((m) => [m, toModality(m, featureMaps[m]?.get(v.id))]),
    ),
  }));

  return NextResponse.json({ rows });
}
