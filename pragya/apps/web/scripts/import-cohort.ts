#!/usr/bin/env bun
/**
 * Import a cohort from canonical DRISHTI JSON format.
 *
 * Usage:
 *   bun run scripts/import-cohort.ts --in exports/synth-a.json
 */
import { readFileSync } from "node:fs";
import { db } from "../lib/db/client";
import {
  biochemFeatures,
  cognitiveAssessments,
  cohorts,
  mciOutcomes,
  mriFeatures,
  octFeatures,
  participants,
  visits,
} from "../lib/db/schema";
import { ensureSchema } from "../lib/db/bootstrap";

type Args = { in: string };

function parseArgs(argv: string[]): Args {
  const args: Args = { in: "" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--in") args.in = String(argv[++i]);
  }
  if (!args.in) {
    console.error("missing --in <path>");
    process.exit(1);
  }
  return args;
}

async function chunkedInsert(d: any, table: any, rows: any[], chunk = 500) {
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    if (slice.length === 0) continue;
    await d.insert(table).values(slice).onConflictDoNothing();
  }
}

export async function importFromObject(payload: any) {
  await ensureSchema();
  const d = db();

  if (payload.format_version !== "1") {
    throw new Error(`unsupported format_version: ${payload.format_version}`);
  }

  await d
    .insert(cohorts)
    .values({
      id: payload.cohort.id,
      name: payload.cohort.name,
      source: payload.cohort.source,
      notes: payload.cohort.notes ?? null,
    })
    .onConflictDoNothing();

  const participantRows = payload.participants.map((p: any) => ({
    id: p.id,
    cohortId: payload.cohort.id,
    ageBaseline: p.age_baseline,
    sex: p.sex,
    educationYears: p.education_years,
    urbanRural: p.urban_rural,
    apoe4Carrier: !!p.apoe4_carrier,
  }));

  const outcomeRows = payload.participants
    .filter((p: any) => p.outcome)
    .map((p: any) => ({
      id: `${p.id}-outcome`,
      participantId: p.id,
      timeYears: p.outcome.time_years,
      mciStatus: !!p.outcome.mci_status,
    }));

  const visitRows: any[] = [];
  const cogRows: any[] = [];
  const mriRows: any[] = [];
  const octRows: any[] = [];
  const bioRows: any[] = [];

  for (const v of payload.visits) {
    visitRows.push({
      id: v.id,
      participantId: v.participant_id,
      visitIndex: v.visit_index,
      ageAtVisit: v.age_at_visit,
      observedAt: new Date(v.observed_at),
    });
    if (v.cognitive) {
      cogRows.push({
        id: `${v.id}-cog`,
        visitId: v.id,
        memory: v.cognitive.memory,
        executive: v.cognitive.executive,
        language: v.cognitive.language,
        attention: v.cognitive.attention,
        visuospatial: v.cognitive.visuospatial,
        mmse: v.cognitive.mmse,
      });
    }
    if (v.mri) {
      mriRows.push({
        id: `${v.id}-mri`,
        visitId: v.id,
        hippocampusL: v.mri.hippocampus_l,
        hippocampusR: v.mri.hippocampus_r,
        entorhinalL: v.mri.entorhinal_l,
        entorhinalR: v.mri.entorhinal_r,
        corticalThicknessMean: v.mri.cortical_thickness_mean,
        ventricularVolume: v.mri.ventricular_volume,
        whiteMatterHyperintensities: v.mri.white_matter_hyperintensities,
      });
    }
    if (v.oct) {
      octRows.push({
        id: `${v.id}-oct`,
        visitId: v.id,
        rnflThickness: v.oct.rnfl_thickness,
        gccThickness: v.oct.gcc_thickness,
        vesselDensity: v.oct.vessel_density,
      });
    }
    if (v.biochem) {
      bioRows.push({
        id: `${v.id}-bio`,
        visitId: v.id,
        hba1c: v.biochem.hba1c,
        ldl: v.biochem.ldl,
        hdl: v.biochem.hdl,
        triglycerides: v.biochem.triglycerides,
        sbp: v.biochem.sbp,
        dbp: v.biochem.dbp,
        bmi: v.biochem.bmi,
      });
    }
  }

  await chunkedInsert(d, participants, participantRows);
  await chunkedInsert(d, visits, visitRows);
  await chunkedInsert(d, cognitiveAssessments, cogRows);
  await chunkedInsert(d, mriFeatures, mriRows);
  await chunkedInsert(d, octFeatures, octRows);
  await chunkedInsert(d, biochemFeatures, bioRows);
  await chunkedInsert(d, mciOutcomes, outcomeRows);

  return {
    participants: participantRows.length,
    visits: visitRows.length,
    outcomes: outcomeRows.length,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[import] reading ${args.in}`);
  const text = readFileSync(args.in, "utf-8");
  const payload = JSON.parse(text);
  const counts = await importFromObject(payload);
  console.log(`[import] inserted: ${JSON.stringify(counts)}`);
  process.exit(0);
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
