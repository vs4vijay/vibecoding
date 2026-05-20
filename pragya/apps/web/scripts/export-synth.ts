#!/usr/bin/env bun
/**
 * Export a cohort (and all its participants/visits/features) to the canonical
 * DRISHTI cohort JSON format (see docs/cohort-format.md).
 *
 * Usage:
 *   bun run scripts/export-synth.ts --cohort SYNTH-A --out exports/synth-a.json
 */
import { eq, inArray } from "drizzle-orm";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
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

type Args = { cohort: string; out: string };

function parseArgs(argv: string[]): Args {
  const args: Args = { cohort: "SYNTH-A", out: "" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--cohort") args.cohort = String(argv[++i]);
    else if (argv[i] === "--out") args.out = String(argv[++i]);
  }
  if (!args.out) args.out = `exports/${args.cohort}.json`;
  return args;
}

function stripJoin(row: any): any {
  if (!row) return null;
  const out: any = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === "id" || k === "visitId") continue;
    out[k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)] = v;
  }
  return out;
}

async function main() {
  await ensureSchema();
  const args = parseArgs(process.argv.slice(2));
  console.log(`[export] cohort=${args.cohort} -> ${args.out}`);

  const d = db();
  const cohortRows = await d.select().from(cohorts).where(eq(cohorts.id, args.cohort)).limit(1);
  if (cohortRows.length === 0) {
    console.error(`[export] cohort not found: ${args.cohort}`);
    process.exit(1);
  }
  const cohort = cohortRows[0]!;

  const ppl = await d.select().from(participants).where(eq(participants.cohortId, args.cohort));
  const participantIds = ppl.map((p) => p.id);
  const vs = participantIds.length
    ? await d.select().from(visits).where(inArray(visits.participantId, participantIds))
    : [];
  const visitIds = vs.map((v) => v.id);

  async function byVisit<T extends { visitId: string }>(table: any): Promise<Map<string, T>> {
    if (visitIds.length === 0) return new Map();
    const rows = (await d.select().from(table).where(inArray(table.visitId, visitIds))) as T[];
    return new Map(rows.map((r) => [r.visitId, r]));
  }
  const cogMap = await byVisit<any>(cognitiveAssessments);
  const mriMap = await byVisit<any>(mriFeatures);
  const octMap = await byVisit<any>(octFeatures);
  const bioMap = await byVisit<any>(biochemFeatures);
  const outcomeRows = participantIds.length
    ? await d.select().from(mciOutcomes).where(inArray(mciOutcomes.participantId, participantIds))
    : [];
  const outcomeMap = new Map(outcomeRows.map((o) => [o.participantId, o]));

  const exportObj = {
    format_version: "1",
    cohort: {
      id: cohort.id,
      name: cohort.name,
      source: cohort.source,
      notes: cohort.notes,
    },
    participants: ppl.map((p) => {
      const outcome = outcomeMap.get(p.id);
      return {
        id: p.id,
        age_baseline: p.ageBaseline,
        sex: p.sex,
        education_years: p.educationYears,
        urban_rural: p.urbanRural,
        apoe4_carrier: p.apoe4Carrier,
        outcome: outcome
          ? { time_years: outcome.timeYears, mci_status: outcome.mciStatus }
          : undefined,
      };
    }),
    visits: vs.map((v) => ({
      id: v.id,
      participant_id: v.participantId,
      visit_index: v.visitIndex,
      age_at_visit: v.ageAtVisit,
      observed_at: v.observedAt,
      cognitive: stripJoin(cogMap.get(v.id)),
      mri: stripJoin(mriMap.get(v.id)),
      oct: stripJoin(octMap.get(v.id)),
      biochem: stripJoin(bioMap.get(v.id)),
    })),
  };

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(exportObj, null, 2));
  console.log(
    `[export] wrote ${exportObj.participants.length} participants, ${exportObj.visits.length} visits to ${args.out}`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
