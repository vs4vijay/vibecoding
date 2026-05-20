#!/usr/bin/env bun
import { sql } from "drizzle-orm";
import { db } from "../lib/db/client";
import { ensureSchema } from "../lib/db/bootstrap";

async function main() {
  await ensureSchema();
  const d = db();
  const tables = [
    "cohorts",
    "participants",
    "visits",
    "cognitive_assessments",
    "mri_features",
    "oct_features",
    "biochem_features",
    "mci_outcomes",
    "jobs",
    "models",
    "predictions",
    "harmonisation_runs",
    "harmonised_features",
    "audits",
  ];
  for (const t of tables) {
    const res = await d.execute(sql.raw(`SELECT count(*)::int AS n FROM ${t}`));
    const rows = (res as any).rows ?? res;
    const first = Array.isArray(rows) ? rows[0] : rows;
    const n = first?.n ?? first?.N ?? first?.count;
    console.log(`${t}: ${n}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
