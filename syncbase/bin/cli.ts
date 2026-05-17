#!/usr/bin/env bun
import { defineCommand, runMain } from "citty";
import { migrate } from "../lib/db/migrate";
import { getDb, closeDb } from "../lib/db";
import { sources } from "../lib/db/schema";
import { eq } from "drizzle-orm";
import { runPipeline } from "../lib/pipeline/run";
import { detectDuplicatesForSource, detectDuplicatesForAllSources } from "../lib/pipeline/dedup";
import { detectCrossSourceDuplicates } from "../lib/pipeline/cross-dedup";

const initCmd = defineCommand({
  meta: { name: "init", description: "Apply migrations" },
  async run() {
    const result = await migrate();
    console.log("applied:", result.applied);
    console.log("skipped:", result.skipped);
    await closeDb();
  },
});

const runCmd = defineCommand({
  meta: { name: "run", description: "Run a source pipeline adhoc" },
  args: {
    source: { type: "string", description: "Source name", required: true },
  },
  async run({ args }) {
    const db = getDb();
    const rows = await db.select().from(sources).where(eq(sources.name, args.source));
    if (rows.length === 0) {
      console.error(`source not found: ${args.source}`);
      process.exit(1);
    }
    const result = await runPipeline(rows[0], "adhoc");
    console.log(JSON.stringify(result, null, 2));
    await closeDb();
  },
});

const sourcesListCmd = defineCommand({
  meta: { name: "list", description: "List sources" },
  async run() {
    const db = getDb();
    const rows = await db.select().from(sources);
    console.table(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        enabled: r.enabled,
        storage_mode: r.storageMode,
        cron: r.scheduleCron ?? "-",
      }))
    );
    await closeDb();
  },
});

const sourcesAddCmd = defineCommand({
  meta: { name: "add", description: "Add a source from a JSON file" },
  args: {
    file: { type: "string", description: "Path to JSON file", required: true },
  },
  async run({ args }) {
    const fs = await import("node:fs/promises");
    const body = JSON.parse(await fs.readFile(args.file, "utf8"));
    const db = getDb();
    const [row] = await db
      .insert(sources)
      .values({
        name: body.name,
        enabled: body.enabled ?? true,
        http: body.http,
        pagination: body.pagination,
        recordsPath: body.records_path,
        externalIdPath: body.external_id_path,
        hashFields: body.hash_fields ?? null,
        scheduleCron: body.schedule_cron ?? null,
        storageMode: body.storage_mode ?? "generic",
        typedColumns: body.typed_columns ?? [],
        storageTable: body.storage_table ?? "entities",
        displayColumns: body.display_columns ?? [],
        category: body.category ?? null,
        location: body.location ?? null,
        dedup: body.dedup ?? null,
        crossDedup: body.cross_dedup ?? null,
      })
      .returning();
    console.log("created source", row);
    await closeDb();
  },
});

const sourcesCmd = defineCommand({
  meta: { name: "sources", description: "Manage sources" },
  subCommands: { list: sourcesListCmd, add: sourcesAddCmd },
});

const workerCmd = defineCommand({
  meta: { name: "worker", description: "Long-lived LISTEN run_due loop" },
  async run() {
    await import("./worker");
  },
});

const dedupCmd = defineCommand({
  meta: { name: "dedup", description: "Run duplicate detection (intra- or cross-source)" },
  args: {
    source: { type: "string", description: "Only run for this source (intra-source only)" },
    "cross-source": { type: "boolean", description: "Run cross-source clustering instead of intra-source dedup", default: false },
  },
  async run({ args }) {
    if (args["cross-source"]) {
      const summary = await detectCrossSourceDuplicates();
      console.log(JSON.stringify(summary, null, 2));
    } else {
      const summaries = args.source
        ? [await detectDuplicatesForSource(args.source)]
        : await detectDuplicatesForAllSources();
      console.log(JSON.stringify(summaries, null, 2));
    }
    await closeDb();
  },
});

const main = defineCommand({
  meta: { name: "syncbase", description: "syncbase CLI" },
  subCommands: {
    init: initCmd,
    run: runCmd,
    sources: sourcesCmd,
    worker: workerCmd,
    dedup: dedupCmd,
  },
});

runMain(main);
