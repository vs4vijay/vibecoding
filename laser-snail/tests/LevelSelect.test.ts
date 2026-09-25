import { describe, expect, it } from 'vitest';

import {
  buildLevelSelectEntries,
  clampSelection,
  defaultSelectionIndex,
  isLevelUnlocked,
  moveSelection,
  selectableEntryAt,
  type LevelSelectEntry,
} from '../src/ui/LevelSelectModel';

/** Level-select lock logic (Phase 5): what the save's unlock chain allows. */

const LEVELS = [
  { id: 1, name: 'Mail Run' },
  { id: 2, name: 'Slug Alley' },
  { id: 3, name: 'Crater Run' },
  { id: 4, name: 'Belt Run' },
];

function entryIds(entries: readonly LevelSelectEntry[]): number[] {
  return entries.filter((entry) => entry.unlocked).map((entry) => entry.id);
}

describe('isLevelUnlocked', () => {
  it('only ids up to the unlock chain are playable', () => {
    expect(isLevelUnlocked(1, 1)).toBe(true);
    expect(isLevelUnlocked(1, 2)).toBe(false);
    expect(isLevelUnlocked(5, 5)).toBe(true);
    expect(isLevelUnlocked(5, 6)).toBe(false);
    expect(isLevelUnlocked(10, 10)).toBe(true);
    expect(isLevelUnlocked(10, 11)).toBe(false); // campaign complete → nothing left
    expect(isLevelUnlocked(3, 0)).toBe(false); // ids are 1-based
    expect(isLevelUnlocked(3, -1)).toBe(false);
  });
});

describe('buildLevelSelectEntries', () => {
  it('marks exactly the unlocked run selectable and carries bests from the save', () => {
    const entries = buildLevelSelectEntries(LEVELS, {
      unlockedLevel: 3,
      bestTimes: { 1: 62.5, 3: 70 },
      bestScores: { 1: 4200 },
    });

    expect(entryIds(entries)).toEqual([1, 2, 3]);
    expect(entries[3].unlocked).toBe(false);

    expect(entries[0].bestTime).toBe(62.5);
    expect(entries[0].bestScore).toBe(4200);
    expect(entries[1].bestTime).toBeNull(); // unlocked but never finished
    expect(entries[1].bestScore).toBeNull();
    expect(entries[2].bestTime).toBe(70);
    expect(entries[2].bestScore).toBeNull();
  });

  it('a fresh save unlocks only level 1; a finished campaign unlocks all', () => {
    expect(entryIds(buildLevelSelectEntries(LEVELS, { unlockedLevel: 1, bestTimes: {}, bestScores: {} }))).toEqual([1]);
    expect(entryIds(buildLevelSelectEntries(LEVELS, { unlockedLevel: 99, bestTimes: {}, bestScores: {} }))).toEqual([
      1, 2, 3, 4,
    ]);
  });
});

describe('selection navigation', () => {
  const entries = buildLevelSelectEntries(LEVELS, { unlockedLevel: 2, bestTimes: {}, bestScores: {} });

  it('clamps out-of-range indexes', () => {
    expect(clampSelection(entries, -3)).toBe(0);
    expect(clampSelection(entries, 2)).toBe(2);
    expect(clampSelection(entries, 9)).toBe(3);
    expect(clampSelection([], 4)).toBe(0);
  });

  it('moves freely inside the unlocked run and never into locked rows', () => {
    expect(moveSelection(entries, 0, 1)).toBe(1); // down
    expect(moveSelection(entries, 1, 1)).toBe(1); // blocked: row 2 is locked
    expect(moveSelection(entries, 1, -1)).toBe(0); // up
    expect(moveSelection(entries, 0, -1)).toBe(0); // blocked at the top
  });

  it('multi-step moves skip locked rows but stop at the locked wall', () => {
    expect(moveSelection(entries, 0, 5)).toBe(1); // +5 wants the end; the wall wins
  });

  it('a fully unlocked list navigates edge to edge', () => {
    const open = buildLevelSelectEntries(LEVELS, { unlockedLevel: 99, bestTimes: {}, bestScores: {} });
    expect(moveSelection(open, 0, 99)).toBe(3);
    expect(moveSelection(open, 3, -99)).toBe(0);
  });

  it('confirm only starts the selected row when it is unlocked', () => {
    expect(selectableEntryAt(entries, 0)?.id).toBe(1);
    expect(selectableEntryAt(entries, 2)).toBeNull(); // locked row
    expect(selectableEntryAt(entries, 42)).toBeNull(); // clamped to a locked row
  });

  it('opens on the newest unlock so Enter resumes the campaign front', () => {
    expect(defaultSelectionIndex(entries)).toBe(1); // level 2 = newest unlock
    expect(defaultSelectionIndex(buildLevelSelectEntries(LEVELS, { unlockedLevel: 1, bestTimes: {}, bestScores: {} }))).toBe(0);
    expect(defaultSelectionIndex(buildLevelSelectEntries(LEVELS, { unlockedLevel: 99, bestTimes: {}, bestScores: {} }))).toBe(3);
  });
});
