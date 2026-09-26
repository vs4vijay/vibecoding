/**
 * Persistence: settings + records (Midtown Blitz game, task 5.1).
 *
 * ONE namespaced localStorage key holds the whole save as JSON — design
 * Decision 10. Reads are wrapped in try/catch and fall back to defaults;
 * writes are whole-object replaces (`setItem` overwrites the key), so a
 * corrupt blob is cleanly overwritten by the next save and a full quota
 * failure can never throw into gameplay.
 *
 * Schema v1 (the `v1` in {@link SAVE_KEY} is the version marker):
 * ```text
 * {
 *   settings: {
 *     volume:  number in [0, 1],        // master volume (engine audio DEFAULT_VOLUME)
 *     muted:   boolean,                 // master mute flag
 *     quality: 'low' | 'medium' | 'high' // renderer quality tier (engine DEFAULT_TIER)
 *   },
 *   records: {
 *     [eventId: string]: {              // one entry per race event (task 5.5)
 *       bestTimeMs?: number,            // best finish time, finite and >= 0
 *       bestMedal?:  'gold' | 'silver' | 'bronze'
 *     }
 *   }
 * }
 * ```
 *
 * Migration policy: the version lives in the key name. A future format adds
 * `midtown-blitz.save.v2` plus a reader that migrates a v1 blob; loadSave for
 * v1 never grows branches. Within v1, UNKNOWN fields found in a stored blob
 * are DROPPED on load (the sanitizers rebuild the result from known fields
 * only) and therefore never re-written — so after corrupt/foreign data lands
 * in the key, the next save stores exactly the known schema (the spec's
 * "overwrites the bad data on the next save").
 *
 * Storage access never throws into the caller: a missing `localStorage`
 * (plain-node harnesses), a throwing `getItem` (some privacy modes), a
 * throwing/quota-failing `setItem`, and unparsable JSON all resolve to
 * defaults or a `false` return instead of an exception. `localStorage` may be
 * injected for tests; anything with `getItem`/`setItem` works.
 */

import { DEFAULT_VOLUME } from '../engine/audio.js';
import { DEFAULT_TIER, QUALITY_TIER_NAMES } from '../engine/renderer.js';

/** The single localStorage key holding the whole save (design Decision 10). */
export const SAVE_KEY = 'midtown-blitz.save.v1';

/** Schema version carried by the key suffix (see the header's migration policy). */
export const SAVE_SCHEMA_VERSION = 1;

/** Medal names a race event record may hold (task 5.5 shape). */
export const MEDAL_NAMES = Object.freeze(['gold', 'silver', 'bronze']);

/** Fresh default settings; the subsystems own the actual values. */
export const DEFAULT_SETTINGS = Object.freeze({
  volume: DEFAULT_VOLUME,
  muted: false,
  quality: DEFAULT_TIER,
});

/**
 * Minimal storage contract used by load/save (a subset of DOM Storage).
 *
 * @typedef {object} StorageLike
 * @property {(key: string) => string | null} getItem Read a key (may throw).
 * @property {(key: string, value: string) => void} setItem Write a key (may throw, e.g. quota).
 */

/**
 * A record entry for one race event (task 5.5 shape).
 *
 * @typedef {object} EventRecord
 * @property {number} [bestTimeMs] Best finish time in ms (finite, >= 0).
 * @property {string} [bestMedal] One of {@link MEDAL_NAMES}.
 */

/**
 * The whole save blob.
 *
 * @typedef {object} SaveData
 * @property {{ volume: number, muted: boolean, quality: string }} settings Sanitized settings.
 * @property {Record<string, EventRecord>} records Per-event records (empty object when none).
 */

/**
 * In-memory stand-in for `localStorage` when it does not exist (plain-node
 * harnesses, or a future non-browser embed). Module-level so an un-injected
 * save→load round-trip still works within one process.
 * @returns {StorageLike} A Map-backed storage.
 */
function createMemoryStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

/** Lazily-created shared fallback so un-injected calls round-trip in-process. */
let memoryStorage = null;

/**
 * Resolve the storage to use: an explicit injection wins, then the browser's
 * `localStorage`, then the in-memory fallback (never throws).
 * @param {StorageLike | undefined} storage Explicit storage (node harnesses).
 * @returns {StorageLike} The storage to read/write.
 */
function resolveStorage(storage) {
  if (storage) return storage;
  if (typeof localStorage !== 'undefined') return localStorage;
  memoryStorage ??= createMemoryStorage();
  return memoryStorage;
}

/**
 * True when n is a usable volume: a finite number (any range — it is clamped
 * to [0, 1], matching audio.setVolume's behavior, so an out-of-range but
 * type-valid value degrades gracefully instead of resetting).
 * @param {unknown} value Candidate value.
 * @returns {boolean} Whether value may become the volume.
 */
function isVolumeLike(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Sanitize a settings object field by field: unknown or wrongly-typed fields
 * fall back to their per-field default, valid ones are kept (and volume is
 * clamped to [0, 1]). Never throws; unknown extra fields are dropped.
 * @param {unknown} raw Parsed JSON candidate for the settings object.
 * @returns {SaveData['settings']} A complete, valid settings object.
 */
export function sanitizeSettings(raw) {
  const src = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const volume = isVolumeLike(src.volume)
    ? Math.min(1, Math.max(0, src.volume))
    : DEFAULT_SETTINGS.volume;
  const muted = typeof src.muted === 'boolean' ? src.muted : DEFAULT_SETTINGS.muted;
  const quality =
    typeof src.quality === 'string' && QUALITY_TIER_NAMES.includes(src.quality)
      ? src.quality
      : DEFAULT_SETTINGS.quality;
  return { volume, muted, quality };
}

/** Event-id keys that must never become own-properties of the records result. */
const UNSAFE_KEYS = Object.freeze(['__proto__', 'constructor', 'prototype']);

/**
 * Sanitize one record entry: keep only a valid `bestTimeMs` (finite >= 0) and
 * a valid `bestMedal`; drop everything else. Returns null when nothing valid
 * remains (the entry is dropped entirely).
 * @param {unknown} raw Candidate entry.
 * @returns {EventRecord | null} The sanitized entry, or null to drop it.
 */
function sanitizeRecordEntry(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const entry = {};
  if (typeof raw.bestTimeMs === 'number' && Number.isFinite(raw.bestTimeMs) && raw.bestTimeMs >= 0) {
    entry.bestTimeMs = raw.bestTimeMs;
  }
  if (typeof raw.bestMedal === 'string' && MEDAL_NAMES.includes(raw.bestMedal)) {
    entry.bestMedal = raw.bestMedal;
  }
  return Object.keys(entry).length > 0 ? entry : null;
}

/**
 * Sanitize the records map: must be a plain object; each value is sanitized
 * through {@link sanitizeRecordEntry}; unsafe keys (`__proto__` etc.) are
 * skipped so a hostile blob can never pollute the result's prototype.
 * Unknown fields inside entries are dropped.
 * @param {unknown} raw Parsed JSON candidate for the records map.
 * @returns {SaveData['records']} A valid records map (possibly empty).
 */
export function sanitizeRecords(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const records = {};
  for (const eventId of Object.keys(raw)) {
    if (UNSAFE_KEYS.includes(eventId)) continue;
    const entry = sanitizeRecordEntry(raw[eventId]);
    if (entry) records[eventId] = entry;
  }
  return records;
}

/**
 * Load the save blob and merge it over the defaults (per design Decision 10):
 * a missing key, unparsable JSON, a non-object payload, or any invalid field
 * resolves to per-field defaults — this function never throws and always
 * returns a complete {@link SaveData}. Unknown extra fields are dropped (see
 * the header). With no storage injected, uses `localStorage` when it exists,
 * else the in-memory fallback.
 * @param {StorageLike} [storage] Injectable storage (node harnesses).
 * @returns {SaveData} { settings, records } with defaults filled in.
 */
export function loadSave(storage) {
  const defaults = { settings: { ...DEFAULT_SETTINGS }, records: {} };
  let store;
  try {
    store = resolveStorage(storage);
  } catch {
    return defaults;
  }
  let raw = null;
  try {
    raw = store.getItem(SAVE_KEY);
  } catch {
    return defaults; // e.g. storage disabled by privacy settings
  }
  if (typeof raw !== 'string') return defaults; // missing key (null) or junk type
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaults; // corrupt JSON -> defaults, never throw (game-shell spec)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return defaults;
  }
  return {
    settings: sanitizeSettings(parsed.settings),
    records: sanitizeRecords(parsed.records),
  };
}

/**
 * Persist the whole save as ONE blob replace ({@link SAVE_KEY}; design
 * Decision 10). The payload is sanitized first, so what lands in storage is
 * always exactly the v1 schema — a previous corrupt blob is overwritten with
 * clean data on this call (game-shell spec, "Corrupted storage tolerated").
 * Storage errors (quota, disabled storage) are swallowed and reported via the
 * boolean return; they never throw into gameplay.
 * @param {SaveData} data Save to write (settings + records; unknown fields dropped).
 * @param {StorageLike} [storage] Injectable storage (node harnesses).
 * @returns {boolean} True when the blob was written, false on storage failure.
 */
export function saveSave(data, storage) {
  const blob = {
    settings: sanitizeSettings(data && data.settings),
    records: sanitizeRecords(data && data.records),
  };
  try {
    resolveStorage(storage).setItem(SAVE_KEY, JSON.stringify(blob));
    return true;
  } catch {
    return false; // quota exceeded / storage disabled — keep running
  }
}
