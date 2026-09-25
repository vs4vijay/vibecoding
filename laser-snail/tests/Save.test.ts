import { describe, expect, it } from 'vitest';

import {
  defaultSave,
  SAVE_KEY,
  SaveService,
  type SaveData,
  type StorageLike,
} from '../src/core/Save';

/** In-memory localStorage stand-in (vitest runs in a node environment). */
function makeStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem(key: string): string | null {
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      data.set(key, value);
    },
    removeItem(key: string): void {
      data.delete(key);
    },
  };
}

const SAMPLE: SaveData = {
  unlockedLevel: 4,
  bestTimes: { 1: 62.5, 2: 71.3 },
  bestScores: { 1: 4200, 2: 5100 },
  muted: true,
};

describe('SaveService', () => {
  it('returns defaults when nothing is stored', () => {
    const save = new SaveService(makeStorage());
    expect(save.data).toEqual(defaultSave());
    expect(save.load()).toEqual(defaultSave());
  });

  it('round-trips data through storage', () => {
    const storage = makeStorage();
    const writer = new SaveService(storage);
    writer.save(structuredClone(SAMPLE));
    expect(storage.data.get(SAVE_KEY)).toBeDefined();

    const reader = new SaveService(storage);
    expect(reader.data).toEqual(SAMPLE);
  });

  it('resets to defaults on corrupt JSON', () => {
    const storage = makeStorage();
    storage.data.set(SAVE_KEY, '{not valid json');
    const save = new SaveService(storage);
    expect(save.data).toEqual(defaultSave());
  });

  it('resets to defaults on wrong shapes — and never throws', () => {
    const storage = makeStorage();
    const save = new SaveService(storage);

    const invalidPayloads: unknown[] = [
      null,
      42,
      'string',
      [],
      { unlockedLevel: '3', bestTimes: {}, bestScores: {}, muted: false }, // wrong type
      { unlockedLevel: 0, bestTimes: {}, bestScores: {}, muted: false }, // below range
      { unlockedLevel: 1.5, bestTimes: {}, bestScores: {}, muted: false }, // not an integer
      { unlockedLevel: 2, bestTimes: [], bestScores: {}, muted: false }, // array map
      { unlockedLevel: 2, bestTimes: { a: 1 }, bestScores: {}, muted: false }, // non-numeric key
      { unlockedLevel: 2, bestTimes: { 1: 'fast' }, bestScores: {}, muted: false }, // non-numeric time
      { unlockedLevel: 2, bestTimes: {}, bestScores: { 1: Number.NaN }, muted: false },
      { unlockedLevel: 2, bestTimes: {}, bestScores: {}, muted: 'no' }, // wrong type
      { unlockedLevel: 2, bestTimes: {}, bestScores: {} }, // missing muted
    ];

    for (const payload of invalidPayloads) {
      storage.data.set(SAVE_KEY, JSON.stringify(payload));
      save.load();
      expect(save.data, `payload ${JSON.stringify(payload)}`).toEqual(defaultSave());
    }
  });

  it('recordResult unlocks the next level and tracks best time/score', () => {
    const save = new SaveService(makeStorage());

    const first = save.recordResult(2, 90, 3200);
    expect(first).toEqual({ newBestTime: true, newBestScore: true, unlockedLevel: 3 });
    expect(save.data.unlockedLevel).toBe(3);
    expect(save.data.bestTimes[2]).toBe(90);
    expect(save.data.bestScores[2]).toBe(3200);

    // Worse run: no new bests, unlock stays.
    const worse = save.recordResult(2, 120, 2800);
    expect(worse.newBestTime).toBe(false);
    expect(worse.newBestScore).toBe(false);
    expect(save.data.bestTimes[2]).toBe(90);
    expect(save.data.bestScores[2]).toBe(3200);

    // Better run: bests update, unlock takes the max.
    const better = save.recordResult(2, 75, 4400);
    expect(better.newBestTime).toBe(true);
    expect(better.newBestScore).toBe(true);
    expect(save.data.bestTimes[2]).toBe(75);
    expect(save.data.bestScores[2]).toBe(4400);
    expect(save.data.unlockedLevel).toBe(3); // max(existing, 2 + 1)

    // Finishing an earlier level never locks anything back.
    save.recordResult(1, 50, 1000);
    expect(save.data.unlockedLevel).toBe(3);
  });

  it('persists the mute flag', () => {
    const storage = makeStorage();
    const save = new SaveService(storage);
    save.setMuted(true);
    expect(save.data.muted).toBe(true);

    const reloaded = new SaveService(storage);
    expect(reloaded.data.muted).toBe(true);

    reloaded.setMuted(false);
    expect(new SaveService(storage).data.muted).toBe(false);
  });

  it('survives a storage backend that throws', () => {
    const hostile: StorageLike = {
      getItem(): string | null {
        throw new Error('storage blocked');
      },
      setItem(): void {
        throw new Error('quota exceeded');
      },
    };
    const save = new SaveService(hostile);
    expect(save.data).toEqual(defaultSave());
    expect(() => save.setMuted(true)).not.toThrow();
    expect(() => save.recordResult(1, 60, 1200)).not.toThrow();
    expect(save.data.unlockedLevel).toBe(2); // cache still updates in memory
  });

  it('works with no storage at all (memory-only)', () => {
    const save = new SaveService(null);
    save.recordResult(1, 55, 1800);
    expect(save.data.unlockedLevel).toBe(2);
    expect(save.load()).toEqual(save.data); // re-read falls back to defaults safely
  });

  it('clear wipes back to defaults', () => {
    const storage = makeStorage();
    const save = new SaveService(storage);
    save.recordResult(3, 80, 3000);
    save.clear();
    expect(save.data).toEqual(defaultSave());
    expect(storage.data.has(SAVE_KEY)).toBe(false);
  });
});
