/**
 * Persistent save service — localStorage key `laser-snail-save-v1`.
 *
 * Shape: `{ unlockedLevel, bestTimes, bestScores, muted }` per the design
 * spec. Any corrupt, malformed, or hostile payload resets to defaults (a
 * broken save must never block boot); writes that fail (private browsing,
 * quota) are swallowed so gameplay continues uninterrupted.
 *
 * The storage backend is injectable: tests pass a stub, headless environments
 * with no `localStorage` get a memory-only fallback automatically.
 */

export interface SaveData {
  /** Highest level id the player may start (1-based; finishing N unlocks N+1). */
  unlockedLevel: number;
  /** Level id → best finish time in seconds. */
  bestTimes: Record<number, number>;
  /** Level id → best total score. */
  bestScores: Record<number, number>;
  muted: boolean;
}

export const SAVE_KEY = 'laser-snail-save-v1';

/** Minimal storage surface (matches DOM Storage; injectable for tests). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export function defaultSave(): SaveData {
  return { unlockedLevel: 1, bestTimes: {}, bestScores: {}, muted: false };
}

export interface RunResult {
  newBestTime: boolean;
  newBestScore: boolean;
  /** The save's unlockedLevel after this result was recorded. */
  unlockedLevel: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Strict per-field validation; returns null when the payload is unusable. */
function validate(raw: unknown): SaveData | null {
  if (!isPlainObject(raw)) return null;

  const unlockedLevel = raw['unlockedLevel'];
  if (typeof unlockedLevel !== 'number' || !Number.isInteger(unlockedLevel) || unlockedLevel < 1) {
    return null;
  }

  const parseMap = (value: unknown): Record<number, number> | null => {
    if (!isPlainObject(value)) return null;
    const map: Record<number, number> = {};
    for (const [key, entry] of Object.entries(value)) {
      const id = Number(key);
      if (!Number.isInteger(id) || id < 1 || typeof entry !== 'number' || !Number.isFinite(entry)) {
        return null;
      }
      map[id] = entry;
    }
    return map;
  };

  const bestTimes = parseMap(raw['bestTimes']);
  if (!bestTimes) return null;
  const bestScores = parseMap(raw['bestScores']);
  if (!bestScores) return null;

  const muted = raw['muted'];
  if (typeof muted !== 'boolean') return null;

  return { unlockedLevel, bestTimes, bestScores, muted };
}

export class SaveService {
  private readonly storage: StorageLike | null;
  private cache: SaveData;

  /**
   * @param storage storage backend; omit to use `globalThis.localStorage`
   *   (falls back to memory-only when unavailable or throwing).
   */
  public constructor(storage?: StorageLike | null) {
    this.storage = storage ?? resolveDefaultStorage();
    this.cache = this.read();
  }

  /** The current save data (cached; mutations go through the service methods). */
  public get data(): Readonly<SaveData> {
    return this.cache;
  }

  /** Re-reads from storage, resetting to defaults when missing or corrupt. */
  public load(): SaveData {
    this.cache = this.read();
    return this.cache;
  }

  /** Persists `data` (a defensive copy is stored) and updates the cache. */
  public save(data: SaveData): void {
    this.cache = {
      unlockedLevel: data.unlockedLevel,
      bestTimes: { ...data.bestTimes },
      bestScores: { ...data.bestScores },
      muted: data.muted,
    };
    if (!this.storage) return;
    try {
      this.storage.setItem(SAVE_KEY, JSON.stringify(this.cache));
    } catch {
      // Storage can throw (quota, privacy mode); gameplay must never care.
    }
  }

  /** Records a finished run: best time (min), best score (max), unlock N+1. */
  public recordResult(levelId: number, timeSeconds: number, score: number): RunResult {
    const next: SaveData = {
      unlockedLevel: Math.max(this.cache.unlockedLevel, levelId + 1),
      bestTimes: { ...this.cache.bestTimes },
      bestScores: { ...this.cache.bestScores },
      muted: this.cache.muted,
    };

    const previousTime = next.bestTimes[levelId];
    const newBestTime = previousTime === undefined || timeSeconds < previousTime;
    if (newBestTime) next.bestTimes[levelId] = timeSeconds;

    const previousScore = next.bestScores[levelId];
    const newBestScore = previousScore === undefined || score > previousScore;
    if (newBestScore) next.bestScores[levelId] = score;

    this.save(next);
    return { newBestTime, newBestScore, unlockedLevel: next.unlockedLevel };
  }

  /** Persists the mute flag and returns the updated save. */
  public setMuted(muted: boolean): SaveData {
    this.save({ ...this.cache, muted });
    return this.cache;
  }

  /** Wipes storage back to defaults (used by the corruption recovery path). */
  public clear(): void {
    this.save(defaultSave());
    try {
      this.storage?.removeItem?.(SAVE_KEY);
    } catch {
      // Ignore — the in-memory cache is already reset.
    }
  }

  private read(): SaveData {
    if (!this.storage) return defaultSave();
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(SAVE_KEY);
    } catch {
      return defaultSave();
    }
    if (raw === null) return defaultSave();

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return defaultSave();
    }

    const validated = validate(parsed);
    return validated ?? defaultSave();
  }
}

/** Best-effort DOM localStorage; null in non-browser environments. */
function resolveDefaultStorage(): StorageLike | null {
  try {
    const storage = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (!storage) return null;
    // Probe once: some environments throw on access, others on first use.
    const probeKey = `${SAVE_KEY}-probe`;
    storage.setItem(probeKey, '1');
    storage.removeItem?.(probeKey);
    return storage;
  } catch {
    return null;
  }
}
