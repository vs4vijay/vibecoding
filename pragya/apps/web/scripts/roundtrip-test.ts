#!/usr/bin/env bun
/**
 * Phase 8 acceptance: drop DB, import canonical export, verify counts match.
 *
 * Usage: bun run scripts/roundtrip-test.ts --in exports/synth-a.json
 */
import { readFileSync, rmSync, existsSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db, getDb } from "../lib/db/client";
import { ensureSchema } from "../lib/db/bootstrap";
import { getConfig } from "../lib/config";
import { importFromObject } from "./import-cohort";

async function tableCount(table: string): Promise<number> {
  const d = db();
  const res = await d.execute(sql.raw(`SELECT count(*)::int AS n FROM ${table}`));
  const rows = (res as any).rows ?? res;
  const first = Array.isArray(rows) ? rows[0] : rows;
  return Number(first?.n ?? 0);
}

async function main() {
  const argv = process.argv.slice(2);
  let inPath = "";
  for (let i = 0; i < argv.length; i++) if (argv[i] === "--in") inPath = String(argv[++i]);
  if (!inPath) {
    console.error("usage: roundtrip-test --in <path>");
    process.exit(1);
  }

  const payload = JSON.parse(readFileSync(inPath, "utf-8"));
  const expectedParticipants = payload.participants.length;
  const expectedVisits = payload.visits.length;

  console.log(`[roundtrip] expected: ${expectedParticipants} participants, ${expectedVisits} visits`);

  await ensureSchema();
  const d = db();
  // Drop all rows from cohort + cascading tables.
  // (We do NOT drop the entire DB because that's slow under PGlite and not required.)
  await d.execute(sql`DELETE FROM cohorts WHERE id = ${payload.cohort.id}`);
  console.log(`[roundtrip] cleared cohort ${payload.cohort.id}`);

  // Verify cleared.
  const beforeP = await d.execute(
    sql`SELECT count(*)::int AS n FROM participants WHERE cohort_id = ${payload.cohort.id}`,
  );
  const beforeRows = ((beforeP as any).rows ?? beforeP) as any[];
  console.log(`[roundtrip] participants in cohort after clear: ${beforeRows[0]?.n}`);

  const counts = await importFromObject(payload);
  console.log(`[roundtrip] imported: ${JSON.stringify(counts)}`);

  // Verify the cohort is restored.
  const afterP = await d.execute(
    sql`SELECT count(*)::int AS n FROM participants WHERE cohort_id = ${payload.cohort.id}`,
  );
  const afterRows = ((afterP as any).rows ?? afterP) as any[];
  const got = Number(afterRows[0]?.n ?? 0);
  console.log(`[roundtrip] participants in cohort after import: ${got}`);

  if (got !== expectedParticipants) {
    console.error(`MISMATCH: expected ${expectedParticipants}, got ${got}`);
    process.exit(2);
  }
  if (counts.visits !== expectedVisits) {
    console.error(`MISMATCH: expected ${expectedVisits} visits, got ${counts.visits}`);
    process.exit(3);
  }
  console.log(`[roundtrip] OK`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
