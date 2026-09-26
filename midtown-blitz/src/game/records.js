/**
 * Records and medals (Midtown Blitz game, task 5.5).
 *
 * Pure per-event record keeping over the save module's records map (design
 * Decision 10: the `records` half of the single save blob). One function,
 * {@link applyFinish}, folds a race finish into the map and reports what
 * changed:
 *
 *  - the best finish time is kept when the new time is STRICTLY lower
 *    (an equal time is not a new best);
 *  - the highest medal is kept independently of time (ranking
 *    gold > silver > bronze), so a SLOWER run can still upgrade the medal —
 *    and a faster run never downgrades it;
 *  - the first finish sets both (a finish without a medal — over the bronze
 *    cutoff but under the timer — records the time and no medal);
 *  - finishes for UNKNOWN event ids (anything outside RACE_EVENT_BY_ID,
 *    Cruise included — it never finishes) are ignored entirely.
 *
 * The map is treated IMMUTABLY: a real update returns a NEW top-level
 * object with a fresh entry and never mutates the input (the menu re-renders
 * from the returned map; main.js reassigns its live `records` variable from
 * it). Ignored inputs return the SAME reference with both flags false.
 *
 * Values are validated defensively (matching the save module's sanitizers):
 * a valid finish needs a known event id and a finite `timeMs >= 0`; a medal
 * that is not one of the save module's {@link MEDAL_NAMES} (or is
 * null/undefined) is treated as "no medal" — it can never overwrite a stored
 * one. Everything is plain data + pure functions: no three.js, no DOM, no
 * timers — plain-node harnesses test it directly
 * (scripts/records-test.mjs).
 */

import { RACE_EVENT_BY_ID } from './races.js';
import { MEDAL_NAMES } from './save.js';

/**
 * A per-event record entry (the save module's shape).
 *
 * @typedef {import('./save.js').EventRecord} EventRecord
 */

/**
 * The records map keyed by event id (the save blob's `records` half).
 *
 * @typedef {Record<string, EventRecord>} RecordsMap
 */

/**
 * Outcome of {@link applyFinish}.
 *
 * @typedef {object} ApplyFinishOutcome
 * @property {RecordsMap} records The (possibly unchanged) records map to
 *   keep using — a NEW object when the finish updated anything, the input
 *   reference when the finish was ignored.
 * @property {boolean} isNewBest True when this finish set a new best time
 *   (the results screen's "NEW RECORD" callout).
 * @property {boolean} isNewMedal True when this finish raised the stored
 *   medal (gold > silver > bronze).
 */

/**
 * Rank of a medal: gold 0 < silver 1 < bronze 2, so the STRICTLY better
 * medal is the strictly LOWER rank. -1 for no medal (null/undefined/unknown
 * string) — any real medal outranks "none".
 *
 * @param {string | null | undefined} medal Medal name to rank.
 * @returns {number} The rank, or -1 when there is no (valid) medal.
 */
export function medalRank(medal) {
  return MEDAL_NAMES.indexOf(medal ?? null);
}

/**
 * Fold one race finish into the records map (see the module header for the
 * rules). Pure: never mutates `records`; never throws.
 *
 * @param {RecordsMap | null | undefined} records Current records map (the
 *   save blob's `records` half; nullish is treated as "no records yet").
 * @param {object | null | undefined} finish The finish to apply.
 * @param {string} finish.eventId Route id (must be one of RACE_EVENT_BY_ID).
 * @param {number} finish.timeMs Finish time in ms (finite, >= 0).
 * @param {'gold' | 'silver' | 'bronze' | null} [finish.medal] Medal for the
 *   time per the route's thresholds (null/undefined = finished with no
 *   medal; an unrecognized string is treated as none).
 * @returns {ApplyFinishOutcome} The next records map + what changed.
 */
export function applyFinish(records, finish) {
  const finishOk = finish !== null && typeof finish === 'object';
  const eventId = finishOk && typeof finish.eventId === 'string' ? finish.eventId : null;
  const timeMs = finishOk ? finish.timeMs : undefined;
  const rawMedal = finishOk ? finish.medal : undefined;
  const medal =
    typeof rawMedal === 'string' && MEDAL_NAMES.includes(rawMedal) ? rawMedal : null;

  // hasOwnProperty (not a bare lookup) so a hostile id like '__proto__'
  // can never pass as a known event.
  const knownEvent =
    eventId !== null && Object.prototype.hasOwnProperty.call(RACE_EVENT_BY_ID, eventId);
  const validTime = typeof timeMs === 'number' && Number.isFinite(timeMs) && timeMs >= 0;

  if (!knownEvent || !validTime) {
    // Ignored finish: nothing changed, nothing copied — the caller keeps
    // its current map and both flags stay false.
    return { records: records ?? {}, isNewBest: false, isNewMedal: false };
  }

  const base =
    records !== null && typeof records === 'object' && !Array.isArray(records)
      ? records
      : {};
  const prevRaw = base[eventId];
  const prev = prevRaw !== null && typeof prevRaw === 'object' ? prevRaw : {};
  const prevTime =
    typeof prev.bestTimeMs === 'number' && Number.isFinite(prev.bestTimeMs) && prev.bestTimeMs >= 0
      ? prev.bestTimeMs
      : null;
  const prevMedal = medalRank(prev.bestMedal) >= 0 ? prev.bestMedal : null;

  const isNewBest = prevTime === null || timeMs < prevTime;
  // A stored medal is only ever upgraded: "none" (first finish / a finish
  // over the bronze cutoff) is outranked by ANY medal, then gold < silver
  // < bronze in rank, so strictly-lower rank = strictly-better medal.
  const isNewMedal =
    medal !== null && (prevMedal === null || medalRank(medal) < medalRank(prevMedal));

  // The new entry keeps the best time and the highest medal INDEPENDENTLY:
  // a record time never downgrades the medal, a better medal never moves
  // the time. Fields are written only when present (a medal-less finish
  // leaves bestMedal out entirely, matching the sanitized save schema).
  const bestTimeMs = isNewBest ? timeMs : prevTime;
  const bestMedal = isNewMedal ? medal : prevMedal;
  const entry = {};
  if (bestTimeMs !== null) entry.bestTimeMs = bestTimeMs;
  if (bestMedal !== null) entry.bestMedal = bestMedal;

  return { records: { ...base, [eventId]: entry }, isNewBest, isNewMedal };
}
