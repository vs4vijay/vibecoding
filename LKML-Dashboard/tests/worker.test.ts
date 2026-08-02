import { eq } from 'drizzle-orm';
import { expect, test } from 'bun:test';
import type { DbHandle } from '../src/db/client';
import { jobs } from '../src/db/schema';
import { enqueueJob } from '../src/jobs/queue';
import { runWorker } from '../src/worker';
import { destroyDb, makeDb } from './helpers';

async function waitForJob(id: string, handle: DbHandle, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [j] = await handle.db.select().from(jobs).where(eq(jobs.id, id));
    if (j && (j.status === 'done' || j.status === 'failed')) return j;
    await Bun.sleep(25);
  }
  return null;
}

test('worker executes an enqueued job and marks it done', async () => {
  const h = await makeDb();
  try {
    const enqueued = await enqueueJob(h.db, 'ingest.series', { source: 'sample', limit: 4 });
    const rt = await runWorker(h, { ingestOnStart: false });

    const finished = await waitForJob(enqueued.id, h);
    expect(finished).not.toBeNull();
    expect(finished?.status).toBe('done');

    const series = await h.db.query.patchSeries.findMany();
    expect(series.length).toBe(4);

    expect(finished?.finishedAt).not.toBeNull();
    await rt.stop();
  } finally {
    await destroyDb(h);
  }
}, 20_000);

test('worker fails unknown task types', async () => {
  const h = await makeDb();
  try {
    const enqueued = await enqueueJob(h.db, 'no.such.task', null);
    const rt = await runWorker(h, { ingestOnStart: false });

    const finished = await waitForJob(enqueued.id, h);
    expect(finished).not.toBeNull();
    expect(finished?.status).toBe('failed');
    expect(finished?.error).toContain('unknown task type');
    await rt.stop();
  } finally {
    await destroyDb(h);
  }
}, 20_000);
