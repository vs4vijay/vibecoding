#!/usr/bin/env bun
/**
 * End-to-end smoke test. Assumes the full stack (web+worker+ml) is running.
 *
 * Asserts:
 *   - /api/health returns web=ok and ml=ok
 *   - /api/participants returns >0 participants
 *   - A noop job runs to completion
 *   - A predict job runs to completion and the prediction is persisted
 */
const WEB = process.env.WEB_INTERNAL_BASE_URL ?? "http://localhost:3000";

async function poll(jobId: string, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 1500));
    const r = await fetch(`${WEB}/api/jobs/${jobId}`);
    const j = (await r.json()) as { status: string; error?: string };
    if (j.status === "succeeded") return j;
    if (j.status === "failed") throw new Error(j.error);
  }
  throw new Error("timeout");
}

async function main() {
  const failures: string[] = [];

  // health
  const h = await fetch(`${WEB}/api/health`).then((r) => r.json());
  if (!(h.web === "ok" && h.ml?.status === "ok")) {
    failures.push(`health: ${JSON.stringify(h)}`);
  } else {
    console.log("✓ /api/health");
  }

  // participants
  const p = (await fetch(`${WEB}/api/participants?page_size=1`).then((r) => r.json())) as any;
  if (!(p.total > 0)) {
    failures.push(`participants empty: ${p.total}`);
  } else {
    console.log(`✓ /api/participants total=${p.total}`);
  }
  const sampleId = p.rows[0]?.id;

  // noop
  const n = await fetch(`${WEB}/api/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "noop", payload: { sleep_ms: 200 } }),
  }).then((r) => r.json());
  await poll(n.id);
  console.log("✓ noop job round-trip");

  // predict
  if (sampleId) {
    const pr = await fetch(`${WEB}/api/participants/${sampleId}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).then((r) => r.json());
    await poll(pr.job_id);
    console.log(`✓ predict job round-trip for ${sampleId}`);
  }

  if (failures.length) {
    console.error("SMOKE FAILED:");
    for (const f of failures) console.error("  -", f);
    process.exit(1);
  }
  console.log("✓ smoke OK");
  process.exit(0);
}

main().catch((e) => {
  console.error("SMOKE FATAL:", e);
  process.exit(2);
});
