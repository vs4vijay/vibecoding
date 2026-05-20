import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  biochemFeatures,
  cognitiveAssessments,
  harmonisedFeatures,
  mciOutcomes,
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
  harmonisation_run_id?: string;
};

function snake(k: string) {
  return k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

function toFeatureObj(raw: any): Record<string, number> {
  if (!raw) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === "id" || k === "visitId") continue;
    if (typeof v === "number") out[snake(k)] = v;
  }
  return out;
}

export async function POST(req: Request) {
  const auth = checkInternalAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 401 });
  await ensureSchema();
  const body = (await req.json()) as Body;
  const d = db();

  const ppl = await d
    .select()
    .from(participants)
    .where(body.cohort_ids.length > 0 ? inArray(participants.cohortId, body.cohort_ids) : undefined as any);
  if (ppl.length === 0) return NextResponse.json({ rows: [], modalities: body.modalities });

  const outRows = await d.select().from(mciOutcomes).where(inArray(mciOutcomes.participantId, ppl.map((p) => p.id)));
  const outcomeByParticipant = new Map(outRows.map((r) => [r.participantId, r]));

  // Latest visit per participant.
  const visitRows = await d.select().from(visits).where(inArray(visits.participantId, ppl.map((p) => p.id)));
  const latestByParticipant = new Map<string, typeof visitRows[number]>();
  for (const v of visitRows) {
    const cur = latestByParticipant.get(v.participantId);
    if (!cur || v.visitIndex > cur.visitIndex) latestByParticipant.set(v.participantId, v);
  }
  const latestVisitIds = Array.from(latestByParticipant.values()).map((v) => v.id);
  if (latestVisitIds.length === 0) return NextResponse.json({ rows: [], modalities: body.modalities });

  const featureMaps: Record<string, Map<string, any>> = {};
  if (body.modalities.includes("cognitive")) {
    const rows = await d.select().from(cognitiveAssessments).where(inArray(cognitiveAssessments.visitId, latestVisitIds));
    featureMaps.cognitive = new Map(rows.map((r) => [r.visitId, r]));
  }
  if (body.modalities.includes("mri")) {
    const rows = await d.select().from(mriFeatures).where(inArray(mriFeatures.visitId, latestVisitIds));
    featureMaps.mri = new Map(rows.map((r) => [r.visitId, r]));
  }
  if (body.modalities.includes("oct")) {
    const rows = await d.select().from(octFeatures).where(inArray(octFeatures.visitId, latestVisitIds));
    featureMaps.oct = new Map(rows.map((r) => [r.visitId, r]));
  }
  if (body.modalities.includes("biochem")) {
    const rows = await d.select().from(biochemFeatures).where(inArray(biochemFeatures.visitId, latestVisitIds));
    featureMaps.biochem = new Map(rows.map((r) => [r.visitId, r]));
  }

  // If harmonisation_run_id provided, overlay harmonised payloads.
  let harmMap: Map<string, Map<string, Record<string, number>>> | null = null;
  if (body.harmonisation_run_id) {
    const rows = await d
      .select()
      .from(harmonisedFeatures)
      .where(eq(harmonisedFeatures.runId, body.harmonisation_run_id));
    harmMap = new Map();
    for (const r of rows) {
      if (!harmMap.has(r.visitId)) harmMap.set(r.visitId, new Map());
      harmMap.get(r.visitId)!.set(r.modality, r.payload as Record<string, number>);
    }
  }

  const rows = ppl
    .map((p) => {
      const visit = latestByParticipant.get(p.id);
      if (!visit) return null;
      const outcome = outcomeByParticipant.get(p.id);
      if (!outcome) return null;
      const features: Record<string, Record<string, number>> = {};
      for (const m of body.modalities) {
        // Prefer harmonised payload if available; else raw.
        const harm = harmMap?.get(visit.id)?.get(m);
        features[m] = harm ?? toFeatureObj(featureMaps[m]?.get(visit.id));
      }
      return {
        participant_id: p.id,
        cohort_id: p.cohortId,
        sex: p.sex,
        age_baseline: p.ageBaseline,
        education_years: p.educationYears,
        urban_rural: p.urbanRural,
        apoe4_carrier: p.apoe4Carrier,
        features,
        time_years: outcome.timeYears,
        mci_status: outcome.mciStatus,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return NextResponse.json({ rows, modalities: body.modalities });
}
