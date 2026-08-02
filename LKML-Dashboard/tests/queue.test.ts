import { eq } from 'drizzle-orm';
import { expect, test } from 'bun:test';
import { jobs } from '../src/db/schema';
import { claimNextJob, completeJob, enqueueJob, failJob } from '../src/jobs/queue';
import { destroyDb, makeDb } from './helpers';

test('claimNextJob returns null when queue is empty', async () => {
  const h = await makeDb();
  try {
    const job = await claimNextJob(h.db, 'worker-a');
    expect(job).toBeNull();
  } finally {
    await destroyDb(h);
  }
});

test('SKIP LOCKED: concurrent claimers never claim the same job twice', async () => {
  const h = await makeDb();
  try {
    const N = 30;
    const workerCount = 5;
    const ids = await Promise.all(
      Array.from({ length: N }, () =>
        enqueueJob(h.db, 'db.ping', null, { notify: false }).then((j) => j.id),
      ),
    );

    const claimAll = async (workerId: string) => {
      const claimed: string[] = [];
      for (let guard = 0; guard < N + 5; guard++) {
        const job = await claimNextJob(h.db, workerId);
        if (!job) break;
        claimed.push(job.id);
      }
      return claimed;
    };

    const results = await Promise.all(
      Array.from({ length: workerCount }, (_, i) => claimAll(`worker-${i}`)),
    );
    const all = results.flat();

    expect(all.length).toBe(N);
    expect(new Set(all).size).toBe(N);
    ids.forEach((id) => expect(all).toContain(id));

    const rows = await h.db.select().from(jobs);
    rows.forEach((r) => expect(r.status).toBe('running'));
    rows.forEach((r) => expect(r.lockedBy).not.toBeNull());
  } finally {
    await destroyDb(h);
  }
});

test('completeJob and failJob transition status correctly', async () => {
  const h = await makeDb();
  try {
    const job = await enqueueJob(h.db, 'db.ping', null, { notify: false });
    await claimNextJob(h.db, 'worker-a');

    await completeJob(h.db, job.id);
    const done = await h.db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(done[0]?.status).toBe('done');
    expect(done[0]?.finishedAt).not.toBeNull();

    const job2 = await enqueueJob(h.db, 'db.ping', null, { notify: false });
    await claimNextJob(h.db, 'worker-a');
    await failJob(h.db, job2.id, 1, 1, new Error('boom'));
    const failed = await h.db.select().from(jobs).where(eq(jobs.id, job2.id));
    expect(failed[0]?.status).toBe('failed');
    expect(failed[0]?.error).toBe('boom');
  } finally {
    await destroyDb(h);
  }
});

test('failJob retries with backoff when attempts remain', async () => {
  const h = await makeDb();
  try {
    const job = await enqueueJob(h.db, 'db.ping', null, { notify: false, maxAttempts: 3 });
    await claimNextJob(h.db, 'worker-a');
    await failJob(h.db, job.id, 1, 3, new Error('transient'));
    const row = await h.db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(row[0]?.status).toBe('pending');
    expect(row[0]?.availableAt.getTime()).toBeGreaterThan(Date.now());
    expect(row[0]?.lockedBy).toBeNull();
  } finally {
    await destroyDb(h);
  }
});
