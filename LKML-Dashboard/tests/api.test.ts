import { expect, test } from 'bun:test';
import { createApp } from '../src/api/app';
import { enqueueJob } from '../src/jobs/queue';
import { runIngest } from '../src/jobs/tasks';
import { destroyDb, makeDb } from './helpers';

function j<T>(res: Response): Promise<T> {
  return res.json() as Promise<T>;
}

async function makeApp() {
  const h = await makeDb();
  await runIngest(h.db, { source: 'sample', limit: 6 });
  return { h, app: createApp(h.db) };
}

interface ListBody {
  items: Array<{
    id: string;
    subject: string;
    status: string;
    patchCount: number;
    reviewCount: number;
  }>;
  total: number;
  limit: number;
  offset: number;
}

test('GET /api/health', async () => {
  const { h, app } = await makeApp();
  try {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    const body = await j<{ ok: boolean; db: string }>(res);
    expect(body.ok).toBe(true);
    expect(body.db).toBe('up');
  } finally {
    await destroyDb(h);
  }
});

test('GET /api/config returns public config without secrets', async () => {
  const { h, app } = await makeApp();
  try {
    const res = await app.request('/api/config');
    const body = await j<Record<string, unknown>>(res);
    expect(body.dbBackend).toBe('pglite');
    expect(Object.keys(body)).not.toContain('DATABASE_URL');
  } finally {
    await destroyDb(h);
  }
});

test('GET /api/series lists series with counts', async () => {
  const { h, app } = await makeApp();
  try {
    const res = await app.request('/api/series?limit=10');
    expect(res.status).toBe(200);
    const body = await j<ListBody>(res);
    expect(body.total).toBe(6);
    expect(body.items.length).toBe(6);
    expect(body.items[0]?.patchCount).toBeGreaterThan(0);
    expect(body.items[0]).toHaveProperty('reviewCount');
    expect(body.items[0]).toHaveProperty('status');
  } finally {
    await destroyDb(h);
  }
});

test('GET /api/series supports status + search filters', async () => {
  const { h, app } = await makeApp();
  try {
    const res = await app.request('/api/series?status=new&limit=50');
    const body = await j<ListBody>(res);
    expect(body.items.every((i) => i.status === 'new')).toBe(true);

    const search = await app.request(`/api/series?q=${encodeURIComponent('net:')}&limit=50`);
    const searchBody = await j<ListBody>(search);
    expect(
      searchBody.items.every((i) => i.subject.toLowerCase().includes('net:')),
    ).toBe(true);
  } finally {
    await destroyDb(h);
  }
});

test('GET /api/series/:id returns full detail', async () => {
  const { h, app } = await makeApp();
  try {
    const list = await j<ListBody>(await app.request('/api/series?limit=1'));
    const id = list.items[0]!.id;
    const res = await app.request(`/api/series/${id}`);
    expect(res.status).toBe(200);
    const body = await j<{ series: { id: string; patches: unknown[]; reviews: unknown[] } }>(res);
    expect(body.series.id).toBe(id);
    expect(Array.isArray(body.series.patches)).toBe(true);
    expect(Array.isArray(body.series.reviews)).toBe(true);
  } finally {
    await destroyDb(h);
  }
});

test('GET /api/series/:id 404 for missing id', async () => {
  const { h, app } = await makeApp();
  try {
    const res = await app.request('/api/series/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  } finally {
    await destroyDb(h);
  }
});

test('GET /api/stats aggregates counts', async () => {
  const { h, app } = await makeApp();
  try {
    const res = await app.request('/api/stats');
    const body = await j<{
      series: number;
      patches: number;
      byStatus: unknown[];
      lastRun: unknown;
    }>(res);
    expect(body.series).toBe(6);
    expect(body.patches).toBeGreaterThan(0);
    expect(body.byStatus.length).toBeGreaterThan(0);
    expect(body.lastRun).not.toBeNull();
  } finally {
    await destroyDb(h);
  }
});

test('POST /api/jobs enqueues known task and rejects unknown', async () => {
  const { h, app } = await makeApp();
  try {
    const ok = await app.request('/api/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'ingest.series', payload: { source: 'sample', limit: 2 } }),
    });
    expect(ok.status).toBe(201);
    const okBody = await j<{ job: { status: string } }>(ok);
    expect(okBody.job.status).toBe('pending');

    const bad = await app.request('/api/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'not.a.task' }),
    });
    expect(bad.status).toBe(400);
  } finally {
    await destroyDb(h);
  }
});

test('invalid query params return 400', async () => {
  const { h, app } = await makeApp();
  try {
    const res = await app.request('/api/series?limit=abc');
    expect(res.status).toBe(400);
  } finally {
    await destroyDb(h);
  }
});

test('GET /api/jobs lists recent jobs', async () => {
  const { h, app } = await makeApp();
  try {
    await enqueueJob(h.db, 'db.ping');
    const res = await app.request('/api/jobs');
    const body = await j<{ items: unknown[] }>(res);
    expect(body.items.length).toBeGreaterThan(0);
  } finally {
    await destroyDb(h);
  }
});
