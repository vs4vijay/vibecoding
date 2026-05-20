import { getConfig } from "./config";
import { handlers, type HandlerCtx } from "./handlers";
import { MLClient } from "./ml-client";
import { WebClient } from "./web-client";

const cfg = getConfig();
const web = new WebClient();
const ml = new MLClient();
const ctx: HandlerCtx = { web, ml, workerId: cfg.WORKER_ID };

let running = true;
process.on("SIGINT", () => {
  console.log(`[worker ${cfg.WORKER_ID}] SIGINT, shutting down...`);
  running = false;
});
process.on("SIGTERM", () => {
  console.log(`[worker ${cfg.WORKER_ID}] SIGTERM, shutting down...`);
  running = false;
});

async function tick() {
  try {
    const { job } = await web.fetchNextJob();
    if (!job) return false;

    const handler = handlers[job.kind];
    console.log(`[worker ${cfg.WORKER_ID}] picked job ${job.id} kind=${job.kind} attempts=${job.attempts}`);
    if (!handler) {
      await web.markJob(job.id, {
        status: "failed",
        error: `no handler for kind=${job.kind}`,
      });
      return true;
    }
    try {
      const out = await handler(job, ctx);
      await web.markJob(job.id, out);
      console.log(`[worker ${cfg.WORKER_ID}] finished job ${job.id} -> ${out.status}`);
    } catch (e) {
      const err = e as Error;
      console.error(`[worker ${cfg.WORKER_ID}] job ${job.id} failed:`, err.message);
      await web.markJob(job.id, { status: "failed", error: err.message });
    }
    return true;
  } catch (e) {
    console.error(`[worker ${cfg.WORKER_ID}] fetch loop error:`, (e as Error).message);
    return false;
  }
}

async function loop() {
  console.log(`[worker ${cfg.WORKER_ID}] worker up; polling ${cfg.WEB_INTERNAL_BASE_URL} every ${cfg.WORKER_POLL_INTERVAL_MS}ms`);
  while (running) {
    const didWork = await tick();
    if (!didWork) {
      await new Promise((r) => setTimeout(r, cfg.WORKER_POLL_INTERVAL_MS));
    }
  }
  console.log(`[worker ${cfg.WORKER_ID}] stopped`);
}

loop().catch((e) => {
  console.error(`[worker ${cfg.WORKER_ID}] fatal:`, e);
  process.exit(1);
});
