#!/usr/bin/env bun
/**
 * One-shot script that takes the system from empty to "trained + sample predictions"
 * by talking to a running web service (port 3000) and ml service (port 8000).
 *
 * Prerequisites:
 *   - apps/web is up:    bun run dev:web
 *   - apps/worker is up: bun run dev:worker
 *   - apps/ml is up:     bun run dev:ml
 *
 * Run from monorepo root:
 *   bun run --cwd apps/web scripts/demo-seed.ts
 *
 * It enqueues jobs against the running web service rather than touching the DB,
 * which avoids PGLite's single-process limitation.
 */
import { spawnSync } from "node:child_process";

const WEB = process.env.WEB_INTERNAL_BASE_URL ?? "http://localhost:3000";

async function poll(jobId: string, label: string, timeoutMs = 180_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 2000));
    const r = await fetch(`${WEB}/api/jobs/${jobId}`);
    if (!r.ok) throw new Error(`poll ${jobId} -> ${r.status}`);
    const j = (await r.json()) as { status: string; error?: string };
    if (j.status === "succeeded") {
      console.log(`  [${label}] done`);
      return;
    }
    if (j.status === "failed") throw new Error(`[${label}] failed: ${j.error}`);
    process.stdout.write(".");
  }
  throw new Error(`[${label}] timed out`);
}

async function postJson(path: string, body: any) {
  const r = await fetch(`${WEB}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${path} -> ${r.status}: ${await r.text()}`);
  return r.json();
}

async function main() {
  console.log("== DRISHTI demo seed ==");

  // Phase 1: verify web + ml + worker are up.
  const health = await fetch(`${WEB}/api/health`).then((r) => r.json());
  if (health.ml?.status !== "ok") throw new Error("ML service is not healthy");
  console.log("✓ web + ml healthy");

  // Phase 5: harmonisation.
  console.log("Harmonisation across SYNTH-A and SYNTH-B...");
  const harm = (await postJson("/api/harmonisation", {
    cohort_ids: ["SYNTH-A", "SYNTH-B"],
    modalities: ["mri", "biochem", "cognitive"],
    seed: 42,
  })) as { job_id: string };
  await poll(harm.job_id, "harmonise");

  // Phase 6: training.
  console.log("Training survival ensemble...");
  const train = (await postJson("/api/models", {
    cohort_ids: ["SYNTH-A", "SYNTH-B"],
    modalities: ["mri", "biochem", "cognitive"],
    horizons_years: [1, 3, 5],
    ensemble_size: 3,
    seed: 42,
  })) as { job_id: string };
  await poll(train.job_id, "train");

  // Get the newly active model id.
  const ms = await fetch(`${WEB}/api/models`).then((r) => r.json());
  const active = ms.models.find((m: any) => m.isActive);
  if (!active) throw new Error("no active model after training");
  console.log(`Active model: ${active.id}`);

  // Phase 7: audit + sample predictions.
  console.log("Running audit...");
  const audit = (await postJson(`/api/models/${active.id}/audit`, {
    cohort_ids: ["SYNTH-A", "SYNTH-B"],
    seed: 42,
  })) as { job_id: string };
  await poll(audit.job_id, "audit");

  console.log("Sample predictions...");
  const sampleIds = [
    "SYNTH-A-42-p00000",
    "SYNTH-A-42-p00005",
    "SYNTH-A-42-p00050",
    "SYNTH-B-7-p00000",
    "SYNTH-B-7-p00050",
  ];
  for (const pid of sampleIds) {
    const r = (await postJson(`/api/participants/${pid}/predict`, {})) as { job_id: string };
    await poll(r.job_id, `predict ${pid}`);
  }
  console.log("== DONE ==");
  console.log(`Open ${WEB} for the demo.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
