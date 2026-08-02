import { sql } from 'drizzle-orm';
import { config } from '../config';
import type { AppDb } from '../db/client';
import { ingestState } from '../db/schema';
import {
  fetchRecentSeries,
  generateSampleSeriesPublic,
  LkmlFetchError,
  upsertSeries,
  type LkmlSource,
} from '../services/lkml';

export interface IngestPayload {
  source?: LkmlSource;
  limit?: number;
  forceSample?: boolean;
}

export async function runIngest(db: AppDb, payload: IngestPayload = {}): Promise<{
  source: string;
  fetched: number;
  inserted: number;
  updated: number;
  elapsedMs: number;
  fallbackUsed: boolean;
}> {
  const source: LkmlSource = payload.source ?? config.LKML_SOURCE;
  const limit = Math.max(1, Math.min(payload.limit ?? config.LKML_FETCH_LIMIT, 500));
  const started = Date.now();

  let summaries;
  let fallbackUsed = false;
  try {
    if (payload.forceSample || source === 'sample') {
      summaries = generateSampleSeriesPublic(20260802, limit);
    } else {
      summaries = await fetchRecentSeries(source, limit);
    }
  } catch (err) {
    if (source === 'sample' || payload.forceSample) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[ingest] source "${source}" failed (${msg}); falling back to sample data`);
    summaries = generateSampleSeriesPublic(20260802, limit);
    fallbackUsed = true;
  }

  const result = await upsertSeries(db, summaries);
  const record = {
    ...result,
    source: fallbackUsed ? 'sample' : source,
    requestedSource: source,
    fallbackUsed,
    at: new Date().toISOString(),
  };
  await db
    .insert(ingestState)
    .values({ key: 'lkml.last_run', value: record })
    .onConflictDoUpdate({
      target: ingestState.key,
      set: { value: record, updatedAt: new Date() },
    });
  console.log(
    `[ingest] ${record.source} fetched=${record.fetched} inserted=${record.inserted} updated=${record.updated} in ${record.elapsedMs}ms`,
  );
  return record;
}

export type TaskHandler = (db: AppDb, payload: Record<string, unknown> | null) => Promise<void>;

export const tasks: Record<string, TaskHandler> = {
  'ingest.series': async (db, payload) => {
    await runIngest(db, (payload ?? {}) as IngestPayload);
  },
  'db.ping': async (db) => {
    await db.execute(sql`select 1`);
  },
};

export function getTask(type: string): TaskHandler | undefined {
  return tasks[type];
}

export function isKnownTask(type: string): boolean {
  return Object.prototype.hasOwnProperty.call(tasks, type);
}
