#!/usr/bin/env bun
import { getDb, listen, getDriver } from "../lib/db";
import { sources } from "../lib/db/schema";
import { eq } from "drizzle-orm";
import { runPipeline } from "../lib/pipeline/run";
import { getScheduler } from "../lib/scheduler";

async function bootstrapSchedulesFromSourcesTable() {
  const db = getDb();
  const all = await db.select().from(sources);
  const sched = getScheduler();
  for (const s of all) {
    if (s.enabled && s.scheduleCron) {
      await sched.register(s.name, s.scheduleCron);
      console.log(`[worker] scheduled ${s.name} @ ${s.scheduleCron}`);
    }
  }
}

async function main() {
  console.log(`[worker] starting (driver=${getDriver()})`);
  await bootstrapSchedulesFromSourcesTable();

  const unlisten = await listen("run_due", async (payload) => {
    const name = payload.trim();
    console.log(`[worker] run_due received: ${name}`);
    const db = getDb();
    const rows = await db.select().from(sources).where(eq(sources.name, name));
    if (rows.length === 0) {
      console.warn(`[worker] no source named ${name}`);
      return;
    }
    const src = rows[0];
    if (!src.enabled) {
      console.warn(`[worker] source ${name} is disabled, skipping`);
      return;
    }
    try {
      const r = await runPipeline(src, "schedule");
      console.log(`[worker] ${name} → ${r.status} seen=${r.recordsSeen} created=${r.recordsCreated} updated=${r.recordsUpdated} skipped=${r.recordsSkipped}`);
    } catch (err) {
      console.error(`[worker] pipeline failed for ${name}:`, err);
    }
  });

  console.log("[worker] LISTEN run_due active");

  const shutdown = async () => {
    console.log("[worker] shutting down…");
    await unlisten();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Block forever
  await new Promise(() => {});
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
