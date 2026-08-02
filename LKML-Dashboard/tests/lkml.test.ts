import { expect, test } from 'bun:test';
import {
  deriveSeriesStatus,
  generateSampleSeriesPublic,
  upsertSeries,
} from '../src/services/lkml';
import { destroyDb, makeDb } from './helpers';

test('deriveSeriesStatus prioritises accepted over new', () => {
  expect(deriveSeriesStatus(['New', 'Accepted'])).toBe('accepted');
  expect(deriveSeriesStatus(['New', 'Under Review'])).toBe('review');
  expect(deriveSeriesStatus(['Superseded', 'New'])).toBe('superseded');
  expect(deriveSeriesStatus(['Rejected'])).toBe('rejected');
  expect(deriveSeriesStatus(['New'])).toBe('new');
});

test('sample data is deterministic for a fixed seed', () => {
  const a = generateSampleSeriesPublic(42, 10, 1_700_000_000_000);
  const b = generateSampleSeriesPublic(42, 10, 1_700_000_000_000);
  expect(a).toEqual(b);
  expect(a.length).toBe(10);
});

test('sample series have valid statuses and positions', () => {
  const rows = generateSampleSeriesPublic(20260802, 20);
  for (const s of rows) {
    expect(['new', 'review', 'accepted', 'superseded', 'rejected', 'merged']).toContain(s.status);
    expect(s.patches.length).toBeGreaterThan(0);
    for (const p of s.patches) {
      expect(p.position).toBeGreaterThan(0);
    }
  }
});

test('upsertSeries is idempotent', async () => {
  const h = await makeDb();
  try {
    const sample = generateSampleSeriesPublic(1, 5);
    const first = await upsertSeries(h.db, sample);
    expect(first.inserted).toBe(5);
    expect(first.updated).toBe(0);

    const second = await upsertSeries(h.db, sample);
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(5);

    const all = await h.db.query.patchSeries.findMany();
    expect(all.length).toBe(5);
  } finally {
    await destroyDb(h);
  }
});
