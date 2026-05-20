#!/usr/bin/env bun
/**
 * Synthetic cohort seeder.
 *
 * Usage:
 *   bun run scripts/seed-synth.ts --participants 500 --visits-per 4 --cohort SYNTH-A --seed 42
 */
import { sql } from "drizzle-orm";
import { db, getDb } from "../lib/db/client";
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
import {
  DEFAULT_OFFSET,
  generateOutcome,
  generateParticipant,
  generateVisits,
} from "../lib/synth/generators";
import { COHORT_OFFSETS } from "../lib/synth/cohort-presets";
import { Rng } from "../lib/synth/rng";

type Args = {
  participants: number;
  visitsPer: number;
  cohort: string;
  seed: number;
  clear: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { participants: 100, visitsPer: 4, cohort: "SYNTH-A", seed: 42, clear: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--participants") args.participants = Number(argv[++i]);
    else if (a === "--visits-per") args.visitsPer = Number(argv[++i]);
    else if (a === "--cohort") args.cohort = String(argv[++i]);
    else if (a === "--seed") args.seed = Number(argv[++i]);
    else if (a === "--clear") args.clear = true;
  }
  return args;
}

function pid(cohort: string, seed: number, i: number) {
  return `${cohort}-${seed}-p${String(i).padStart(5, "0")}`;
}
function vid(cohort: string, seed: number, i: number, v: number) {
  return `${pid(cohort, seed, i)}-v${v}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[seed] cohort=${args.cohort} n=${args.participants} visits=${args.visitsPer} seed=${args.seed}`);
  await ensureSchema();

  const offset = COHORT_OFFSETS[args.cohort] ?? DEFAULT_OFFSET;
  const rng = new Rng(args.seed);
  const d = db();

  if (args.clear) {
    console.log(`[seed] clearing existing rows for cohort ${args.cohort}`);
    await d.execute(sql`DELETE FROM cohorts WHERE id = ${args.cohort}`);
  }

  // Upsert cohort row.
  await d
    .insert(cohorts)
    .values({
      id: args.cohort,
      name: args.cohort,
      source: args.cohort.startsWith("SYNTH") ? "SYNTH" : args.cohort,
      notes: `Seeded with seed=${args.seed}, n=${args.participants}, visits=${args.visitsPer}`,
    })
    .onConflictDoNothing();

  const now = new Date();
  const baseYear = now.getUTCFullYear() - args.visitsPer + 1;

  const handle = getDb();
  const useTxn = handle.driver === "pglite";

  const insertParticipantsBatch: any[] = [];
  const insertVisitsBatch: any[] = [];
  const insertCogBatch: any[] = [];
  const insertMriBatch: any[] = [];
  const insertOctBatch: any[] = [];
  const insertBioBatch: any[] = [];
  const insertOutcomesBatch: any[] = [];

  for (let i = 0; i < args.participants; i++) {
    const baseline = generateParticipant(rng, { cohortId: args.cohort, cohortOffset: offset });
    const vs = generateVisits(rng, baseline, args.visitsPer, offset);
    const outcome = generateOutcome(rng, baseline, vs);

    const participantId = pid(args.cohort, args.seed, i);
    insertParticipantsBatch.push({
      id: participantId,
      cohortId: args.cohort,
      ageBaseline: baseline.ageBaseline,
      sex: baseline.sex as "M" | "F",
      educationYears: baseline.educationYears,
      urbanRural: baseline.urbanRural as "urban" | "rural",
      apoe4Carrier: baseline.apoe4Carrier,
    });
    insertOutcomesBatch.push({
      id: `${participantId}-outcome`,
      participantId,
      timeYears: outcome.timeYears,
      mciStatus: outcome.mciStatus,
    });
    for (const v of vs) {
      const visitId = vid(args.cohort, args.seed, i, v.visitIndex);
      const observedAt = new Date(Date.UTC(baseYear + v.visitIndex, 0, 1 + (i % 28)));
      insertVisitsBatch.push({
        id: visitId,
        participantId,
        visitIndex: v.visitIndex,
        ageAtVisit: v.ageAtVisit,
        observedAt,
      });
      insertCogBatch.push({ id: `${visitId}-cog`, visitId, ...v.cognitive });
      insertMriBatch.push({ id: `${visitId}-mri`, visitId, ...v.mri });
      insertOctBatch.push({ id: `${visitId}-oct`, visitId, ...v.oct });
      insertBioBatch.push({ id: `${visitId}-bio`, visitId, ...v.biochem });
    }
  }

  console.log(
    `[seed] writing rows: participants=${insertParticipantsBatch.length}, visits=${insertVisitsBatch.length}`,
  );

  // Chunk inserts to keep individual INSERT payloads modest.
  async function chunkedInsert(table: any, rows: any[], chunk = 500) {
    for (let i = 0; i < rows.length; i += chunk) {
      const slice = rows.slice(i, i + chunk);
      await d.insert(table).values(slice).onConflictDoNothing();
    }
  }

  await chunkedInsert(participants, insertParticipantsBatch);
  await chunkedInsert(visits, insertVisitsBatch);
  await chunkedInsert(cognitiveAssessments, insertCogBatch);
  await chunkedInsert(mriFeatures, insertMriBatch);
  await chunkedInsert(octFeatures, insertOctBatch);
  await chunkedInsert(biochemFeatures, insertBioBatch);
  await chunkedInsert(mciOutcomes, insertOutcomesBatch);

  console.log(`[seed] done.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
