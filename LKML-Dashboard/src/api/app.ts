import { and, count, desc, eq, ilike, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { config } from '../config';
import type { AppDb } from '../db/client';
import { ingestState, jobs, patchSeries, patches, reviews } from '../db/schema';
import { enqueueJob } from '../jobs/queue';
import { isKnownTask, tasks } from '../jobs/tasks';

const listQuerySchema = z.object({
  status: z
    .enum(['new', 'review', 'accepted', 'superseded', 'rejected', 'merged', 'ignored'])
    .optional(),
  q: z.string().trim().max(200).optional(),
  source: z.enum(['patchwork', 'lore', 'sample']).optional(),
  author: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const enqueueBodySchema = z.object({
  type: z.string().min(1).max(100),
  payload: z.record(z.string(), z.unknown()).optional(),
  runAt: z.coerce.date().optional(),
});

export function createApp(db: AppDb): Hono {
  const app = new Hono();

  app.use('/api/*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['Content-Type'] }));

  app.get('/api/health', async (c) => {
    try {
      await db.execute(sql`select 1`);
      return c.json({ ok: true, db: 'up', backend: config.DB_BACKEND, time: new Date().toISOString() });
    } catch {
      return c.json({ ok: false, db: 'down' }, 503);
    }
  });

  app.get('/api/config', (c) =>
    c.json({
      dbBackend: config.DB_BACKEND,
      lkmlSource: config.LKML_SOURCE,
      lkmlFetchLimit: config.LKML_FETCH_LIMIT,
      lkmlFetchIntervalMs: config.LKML_FETCH_INTERVAL_MS,
      workerConcurrency: config.WORKER_CONCURRENCY,
      autoIngest: config.AUTO_INGEST,
    }),
  );

  app.get('/api/series', async (c) => {
    const parsed = listQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: 'invalid_query', issues: parsed.error.issues }, 400);
    }
    const { status, q, source, author, limit, offset } = parsed.data;

    const conds = [];
    if (status) conds.push(eq(patchSeries.status, status));
    if (source) conds.push(eq(patchSeries.source, source));
    if (q) conds.push(ilike(patchSeries.subject, `%${q}%`));
    if (author) conds.push(ilike(patchSeries.author, `%${author}%`));
    const where = conds.length ? and(...conds) : undefined;

    const [rows, totalRows] = await Promise.all([
      db.query.patchSeries.findMany({
        where,
        orderBy: (t, { desc }) => [desc(t.date)],
        limit,
        offset,
        with: {
          patches: { columns: { id: true } },
          reviews: { columns: { id: true } },
        },
      }),
      db.select({ n: count() }).from(patchSeries).where(where),
    ]);

    const items = rows.map((r) => ({
      id: r.id,
      messageId: r.messageId,
      subject: r.subject,
      author: r.author,
      authorEmail: r.authorEmail,
      date: r.date,
      version: r.version,
      numPatches: r.numPatches,
      status: r.status,
      source: r.source,
      project: r.project,
      webUrl: r.webUrl,
      threadUrl: r.threadUrl,
      tags: r.tags,
      patchCount: r.patches.length,
      reviewCount: r.reviews.length,
    }));

    return c.json({ items, limit, offset, total: totalRows[0]?.n ?? 0 });
  });

  app.get('/api/series/:id', async (c) => {
    const id = c.req.param('id');
    const row = await db.query.patchSeries.findFirst({
      where: eq(patchSeries.id, id),
      with: {
        patches: { orderBy: (t, { asc }) => [asc(t.position)] },
        reviews: { orderBy: (t, { asc }) => [asc(t.date)] },
      },
    });
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json({ series: row });
  });

  app.get('/api/stats', async (c) => {
    const byStatus = await db
      .select({ status: patchSeries.status, count: count() })
      .from(patchSeries)
      .groupBy(patchSeries.status);
    const bySource = await db
      .select({ source: patchSeries.source, count: count() })
      .from(patchSeries)
      .groupBy(patchSeries.source);
    const [seriesTotal, patchTotal, reviewTotal] = await Promise.all([
      db.select({ n: count() }).from(patchSeries),
      db.select({ n: count() }).from(patches),
      db.select({ n: count() }).from(reviews),
    ]);
    const lastRun = await db.query.ingestState.findFirst({
      where: eq(ingestState.key, 'lkml.last_run'),
    });
    return c.json({
      series: seriesTotal[0]?.n ?? 0,
      patches: patchTotal[0]?.n ?? 0,
      reviews: reviewTotal[0]?.n ?? 0,
      byStatus,
      bySource,
      lastRun: lastRun?.value ?? null,
    });
  });

  app.get('/api/jobs', async (c) => {
    const rows = await db.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(100);
    return c.json({ items: rows });
  });

  app.post('/api/jobs', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = enqueueBodySchema.safeParse(body ?? {});
    if (!parsed.success) {
      return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
    }
    const { type, payload, runAt } = parsed.data;
    if (!isKnownTask(type)) {
      return c.json({ error: `unknown task type: ${type}`, knownTypes: Object.keys(tasks) }, 400);
    }
    const job = await enqueueJob(db, type, payload ?? null, { availableAt: runAt });
    return c.json({ job }, 201);
  });

  app.get('/api/meta', async (c) => {
    const lastRun = await db.query.ingestState.findFirst({
      where: eq(ingestState.key, 'lkml.last_run'),
    });
    return c.json({ lastRun: lastRun?.value ?? null });
  });

  return app;
}
