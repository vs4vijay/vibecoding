import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
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

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = checkInternalAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 401 });
  await ensureSchema();
  const { id } = await params;
  const d = db();

  const p = await d.select().from(participants).where(eq(participants.id, id)).limit(1);
  if (p.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const participant = p[0]!;

  const latest = await d
    .select()
    .from(visits)
    .where(eq(visits.participantId, id))
    .orderBy(desc(visits.visitIndex))
    .limit(1);
  if (latest.length === 0) {
    return NextResponse.json({
      participant,
      latest_visit: null,
      features: {
        age_baseline: participant.ageBaseline,
        education_years: participant.educationYears,
        is_female: participant.sex === "F" ? 1 : 0,
        is_urban: participant.urbanRural === "urban" ? 1 : 0,
        apoe4_carrier: participant.apoe4Carrier ? 1 : 0,
      },
    });
  }

  const visit = latest[0]!;
  const [cog] = await d.select().from(cognitiveAssessments).where(eq(cognitiveAssessments.visitId, visit.id)).limit(1);
  const [mri] = await d.select().from(mriFeatures).where(eq(mriFeatures.visitId, visit.id)).limit(1);
  const [oct] = await d.select().from(octFeatures).where(eq(octFeatures.visitId, visit.id)).limit(1);
  const [bio] = await d.select().from(biochemFeatures).where(eq(biochemFeatures.visitId, visit.id)).limit(1);

  const features = {
    // demographics
    age_baseline: participant.ageBaseline,
    education_years: participant.educationYears,
    is_female: participant.sex === "F" ? 1 : 0,
    is_urban: participant.urbanRural === "urban" ? 1 : 0,
    apoe4_carrier: participant.apoe4Carrier ? 1 : 0,
    // cognitive
    memory: cog?.memory,
    executive: cog?.executive,
    language: cog?.language,
    attention: cog?.attention,
    visuospatial: cog?.visuospatial,
    mmse: cog?.mmse,
    // mri
    hippocampus_l: mri?.hippocampusL,
    hippocampus_r: mri?.hippocampusR,
    entorhinal_l: mri?.entorhinalL,
    entorhinal_r: mri?.entorhinalR,
    cortical_thickness_mean: mri?.corticalThicknessMean,
    ventricular_volume: mri?.ventricularVolume,
    white_matter_hyperintensities: mri?.whiteMatterHyperintensities,
    // oct
    rnfl_thickness: oct?.rnflThickness,
    gcc_thickness: oct?.gccThickness,
    vessel_density: oct?.vesselDensity,
    // biochem
    hba1c: bio?.hba1c,
    ldl: bio?.ldl,
    hdl: bio?.hdl,
    triglycerides: bio?.triglycerides,
    sbp: bio?.sbp,
    dbp: bio?.dbp,
    bmi: bio?.bmi,
  };

  return NextResponse.json({
    participant,
    latest_visit: visit,
    features,
  });
}
