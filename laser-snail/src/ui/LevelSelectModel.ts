/**
 * Level-select logic — pure, no DOM. The lock chain comes straight from the
 * save (`unlockedLevel` is the highest playable id; finishing N unlocks N+1),
 * and the selection walker skips locked rows so keyboard navigation can never
 * land on (or start) an unearned level. `Screens.ts` renders the entries this
 * produces; `main.ts` drives the selection with `moveSelection`.
 */

/** One row of the level-select screen. */
export interface LevelSelectEntry {
  readonly id: number;
  readonly name: string;
  /** Whether the save's unlock chain allows starting this level. */
  readonly unlocked: boolean;
  /** Best finish time in seconds, or null when never finished. */
  readonly bestTime: number | null;
  /** Best total score, or null when never finished. */
  readonly bestScore: number | null;
}

/** Minimal save shape this module consumes (structural — easy to stub). */
export interface LevelSelectSave {
  readonly unlockedLevel: number;
  readonly bestTimes: Readonly<Record<number, number>>;
  readonly bestScores: Readonly<Record<number, number>>;
}

/** A level id is playable iff the unlock chain has reached it (ids are 1-based). */
export function isLevelUnlocked(unlockedLevel: number, id: number): boolean {
  return id >= 1 && id <= unlockedLevel;
}

/**
 * Builds the screen rows for the campaign in the given (ascending) order,
 * annotated with lock state and per-level bests from the save.
 */
export function buildLevelSelectEntries(
  levels: ReadonlyArray<{ id: number; name: string }>,
  save: LevelSelectSave,
): LevelSelectEntry[] {
  return levels.map((level) => ({
    id: level.id,
    name: level.name,
    unlocked: isLevelUnlocked(save.unlockedLevel, level.id),
    bestTime: save.bestTimes[level.id] ?? null,
    bestScore: save.bestScores[level.id] ?? null,
  }));
}

/** Clamps a raw selection index into `[0, entries.length)`. */
export function clampSelection(entries: readonly unknown[], index: number): number {
  if (entries.length === 0) return 0;
  return Math.min(entries.length - 1, Math.max(0, index));
}

/**
 * Moves the selection `delta` rows (negative = up, positive = down), skipping
 * locked entries. Each single step lands on the next selectable row in that
 * direction; if none exists (top/bottom of the unlocked run), the selection
 * stays put. Returns the new index.
 */
export function moveSelection(
  entries: readonly LevelSelectEntry[],
  currentIndex: number,
  delta: number,
): number {
  if (entries.length === 0) return 0;
  let index = clampSelection(entries, currentIndex);
  const step = delta < 0 ? -1 : 1;
  for (let remaining = Math.abs(delta); remaining > 0; remaining -= 1) {
    let next = index;
    while (true) {
      next += step;
      if (next < 0 || next >= entries.length) break; // edge — this step blocked
      if (entries[next].unlocked) break; // landed on a selectable row
    }
    if (next < 0 || next >= entries.length) break; // blocked: keep the index
    index = next;
  }
  return index;
}

/**
 * The index the screen should highlight when it opens: the newest unlock
 * (highest unlocked id) so Enter resumes the campaign front.
 */
export function defaultSelectionIndex(entries: readonly LevelSelectEntry[]): number {
  let index = 0;
  for (let i = 0; i < entries.length; i += 1) {
    if (entries[i].unlocked) index = i;
  }
  return index;
}

/**
 * Guards the confirm action: the id under the selection is only started when
 * it is unlocked. Returns the entry or null (locked / empty list).
 */
export function selectableEntryAt(
  entries: readonly LevelSelectEntry[],
  index: number,
): LevelSelectEntry | null {
  const entry = entries[clampSelection(entries, index)];
  if (!entry || !entry.unlocked) return null;
  return entry;
}
