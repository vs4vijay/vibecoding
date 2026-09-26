#!/usr/bin/env node
/**
 * Scripted verification harness for src/game/records.js (task 5.5) plus the
 * task 5.5 UI additions to the results screen (NEW RECORD badge, medal
 * tint). Runs under plain node (no browser, no jsdom): a fake in-memory
 * storage stands in for localStorage, and a minimal element stub mounts the
 * results screen. Assertions, per the task:
 *
 *   a. first finish  -> sets bestTimeMs + bestMedal, isNewBest true (and a
 *                       medal-less first finish records the time only)
 *   b. faster/slower -> a faster time replaces the best (isNewBest true), a
 *                       slower one does not (isNewBest false, time kept)
 *   c. medal upgrade -> a SLOWER run with a better medal upgrades the medal,
 *                       never the time (isNewMedal true, isNewBest false)
 *   d. medal ranking -> gold > silver > bronze; no downgrades; medalRank
 *   e. unknown ids   -> unknown eventId / Cruise / junk input ignored (same
 *                       reference back, both flags false)
 *   f. immutability  -> the input records object is never mutated
 *   g. round-trip    -> applyFinish chain -> saveSave -> loadSave returns
 *                       equal records (fake storage)
 *   h. corrupt store -> corrupt stored records load as defaults, and the
 *                       first finish then writes a clean blob over them
 *   i. results UI    -> isNewBest shows the NEW RECORD badge (win variant
 *                       only), the medal slot is tinted while its text
 *                       stays the plain uppercased name, the BEST slot
 *                       shows the passed standing best
 *
 * Run: node scripts/records-test.mjs   (plain node, no dependencies)
 */
import {
  applyFinish,
  medalRank,
} from '../src/game/records.js';
import {
  SAVE_KEY,
  loadSave,
  saveSave,
} from '../src/game/save.js';
import { formatRecordTime, MEDAL_COLORS } from '../src/ui/main-menu.js';
import { createResultsScreen } from '../src/ui/results-screen.js';

let checks = 0;
let failed = 0;

/**
 * Record a single assertion.
 * @param {boolean} cond Condition to assert.
 * @param {string} label Human-readable assertion description.
 * @returns {boolean} Whether the assertion passed.
 */
function check(cond, label) {
  checks += 1;
  if (!cond) {
    failed += 1;
    console.log(`    FAIL ${label}`);
  }
  return cond;
}

/**
 * Record a named section header.
 * @param {string} name Section name.
 * @returns {void}
 */
function section(name) {
  console.log(`  ${name}`);
}

/**
 * Deep-equal for plain JSON data (records/settings shapes only).
 * @param {unknown} a Left value.
 * @param {unknown} b Right value.
 * @returns {boolean} Whether the values are structurally equal.
 */
function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Build a fresh in-memory storage fake (localStorage stand-in).
 * @returns {{ store: { getItem: (k: string) => string | null, setItem: (k: string, v: string) => void }, dump: () => string | null, setRaw: (v: string | null) => void }} The fake plus read/write helpers.
 */
function makeFakeStorage() {
  const map = new Map();
  return {
    store: {
      getItem(key) {
        return map.has(key) ? map.get(key) : null;
      },
      setItem(key, value) {
        map.set(key, String(value));
      },
    },
    dump() {
      return map.has(SAVE_KEY) ? map.get(SAVE_KEY) : null;
    },
    /**
     * Plant an arbitrary raw string under the save key.
     * @param {string | null} v Raw JSON (or garbage) to plant; null removes.
     * @returns {void}
     */
    setRaw(v) {
      if (v === null) map.delete(SAVE_KEY);
      else map.set(SAVE_KEY, v);
    },
  };
}

/* ------------------------------------------------------------------ */
/* a. First finish sets best + medal                                   */
/* ------------------------------------------------------------------ */

section('a. first finish sets bestTimeMs + bestMedal, isNewBest true');
{
  const outcome = applyFinish({}, { eventId: 'blitz-downtown', timeMs: 40000, medal: 'silver' });
  check(
    deepEqual(outcome.records, { 'blitz-downtown': { bestTimeMs: 40000, bestMedal: 'silver' } }),
    'first finish writes the full entry (time + medal)'
  );
  check(outcome.isNewBest === true, 'first finish is a new best');
  check(outcome.isNewMedal === true, 'first finish establishes the medal');

  // A finish over the bronze cutoff (no medal) records the time only.
  const noMedal = applyFinish({}, { eventId: 'blitz-tower', timeMs: 90000, medal: null });
  check(
    deepEqual(noMedal.records, { 'blitz-tower': { bestTimeMs: 90000 } }),
    'a medal-less first finish records the time with NO bestMedal field'
  );
  check(noMedal.isNewBest === true && noMedal.isNewMedal === false,
    'medal-less first finish: new best, no medal change');

  // Applying onto null/undefined records behaves like an empty map.
  const fromNull = applyFinish(null, { eventId: 'blitz-riverside', timeMs: 1, medal: 'gold' });
  check(
    deepEqual(fromNull.records, { 'blitz-riverside': { bestTimeMs: 1, bestMedal: 'gold' } }),
    'null records start from an empty map'
  );
}

/* ------------------------------------------------------------------ */
/* b. Faster replaces, slower does not                                 */
/* ------------------------------------------------------------------ */

section('b. faster time replaces the best; slower time does not');
{
  const base = { 'blitz-downtown': { bestTimeMs: 40000, bestMedal: 'silver' } };

  const faster = applyFinish(base, { eventId: 'blitz-downtown', timeMs: 38000, medal: 'gold' });
  check(faster.isNewBest === true, 'a faster finish is a new best');
  check(faster.records['blitz-downtown'].bestTimeMs === 38000, 'the best time is replaced');
  check(faster.records['blitz-downtown'].bestMedal === 'gold',
    'a better medal on a record run is kept too');

  const slower = applyFinish(base, { eventId: 'blitz-downtown', timeMs: 45000, medal: 'bronze' });
  check(slower.isNewBest === false, 'a slower finish is NOT a new best');
  check(slower.records['blitz-downtown'].bestTimeMs === 40000, 'the best time is kept');
  check(slower.records['blitz-downtown'].bestMedal === 'silver',
    'a worse medal on a slower run changes nothing');

  // An EQUAL time is not a new best (strictly faster only).
  const equal = applyFinish(base, { eventId: 'blitz-downtown', timeMs: 40000, medal: null });
  check(equal.isNewBest === false && equal.records['blitz-downtown'].bestTimeMs === 40000,
    'an equal time is not a new best');

  // A faster run never downgrades a stored medal.
  const goldBase = { 'blitz-tower': { bestTimeMs: 60000, bestMedal: 'gold' } };
  const fasterWorse = applyFinish(goldBase, { eventId: 'blitz-tower', timeMs: 50000, medal: 'bronze' });
  check(
    fasterWorse.isNewBest === true &&
      fasterWorse.records['blitz-tower'].bestTimeMs === 50000 &&
      fasterWorse.records['blitz-tower'].bestMedal === 'gold',
    'a record run with a worse medal keeps the higher stored medal'
  );
}

/* ------------------------------------------------------------------ */
/* c. Medal upgrades independently of time                             */
/* ------------------------------------------------------------------ */

section('c. a slower run with a better medal upgrades the medal, not the time');
{
  const base = { 'blitz-downtown': { bestTimeMs: 40000, bestMedal: 'bronze' } };
  const upgraded = applyFinish(base, { eventId: 'blitz-downtown', timeMs: 42000, medal: 'gold' });
  check(upgraded.isNewMedal === true, 'the better medal is reported as isNewMedal');
  check(upgraded.isNewBest === false, 'the slower run is not a new best');
  check(upgraded.records['blitz-downtown'].bestMedal === 'gold', 'the medal upgraded');
  check(upgraded.records['blitz-downtown'].bestTimeMs === 40000, 'the best time did NOT move');

  // A null medal can never erase a stored one.
  const noMedal = applyFinish(base, { eventId: 'blitz-downtown', timeMs: 42000, medal: null });
  check(noMedal.isNewMedal === false && noMedal.records['blitz-downtown'].bestMedal === 'bronze',
    'a medal-less finish never clears a stored medal');
}

/* ------------------------------------------------------------------ */
/* d. Medal ranking gold > silver > bronze                             */
/* ------------------------------------------------------------------ */

section('d. medal ranking gold > silver > bronze (no downgrades)');
{
  check(medalRank('gold') < medalRank('silver') && medalRank('silver') < medalRank('bronze'),
    'medalRank orders gold < silver < bronze (strictly better = strictly lower)');
  check(medalRank(null) === -1 && medalRank(undefined) === -1 && medalRank('platinum') === -1,
    'medalRank ranks no/unknown medal as -1');

  // Bronze -> silver -> gold chain upgrades step by step.
  let records = {};
  const chain = [
    ['bronze', 70000, 'bronze'],
    ['silver', 69000, 'silver'],
    ['gold', 68000, 'gold'],
  ];
  for (const [medal, time, expected] of chain) {
    const step = applyFinish(records, { eventId: 'blitz-riverside', timeMs: time, medal });
    check(step.records['blitz-riverside'].bestMedal === expected,
      `a ${medal} finish against ${expected === 'bronze' ? 'nothing' : 'a lower medal'} stores ${expected}`);
    records = step.records;
  }
  // From gold, nothing upgrades anymore (silver/bronze keep gold).
  const afterGold = applyFinish(records, { eventId: 'blitz-riverside', timeMs: 69000, medal: 'silver' });
  check(afterGold.isNewMedal === false && afterGold.records['blitz-riverside'].bestMedal === 'gold',
    'gold is never downgraded by a silver finish');
}

/* ------------------------------------------------------------------ */
/* e. Unknown event ids + junk input are ignored                       */
/* ------------------------------------------------------------------ */

section('e. unknown event ids and invalid input are ignored (unchanged out)');
{
  const base = { 'blitz-downtown': { bestTimeMs: 40000, bestMedal: 'silver' } };

  const unknown = applyFinish(base, { eventId: 'blitz-nope', timeMs: 1000, medal: 'gold' });
  check(unknown.records === base && unknown.isNewBest === false && unknown.isNewMedal === false,
    'an unknown eventId returns the SAME records reference, flags false');

  const cruise = applyFinish(base, { eventId: 'cruise', timeMs: 1000, medal: 'gold' });
  check(cruise.records === base, 'the cruise id is not a recordable event (never finishes)');

  const proto = applyFinish(base, { eventId: '__proto__', timeMs: 1000, medal: 'gold' });
  check(proto.records === base && !('bestTimeMs' in proto.records),
    'a hostile id like __proto__ is not a known event');

  for (const [name, time] of [['NaN', Number.NaN], ['Infinity', Number.POSITIVE_INFINITY], ['negative', -1], ['string', 'fast']]) {
    const junk = applyFinish(base, { eventId: 'blitz-downtown', timeMs: time, medal: 'gold' });
    check(junk.records === base && junk.isNewBest === false,
      `an invalid timeMs (${name}) is ignored entirely`);
  }

  const junkFinish = applyFinish(base, null);
  const junkFinish2 = applyFinish(base, undefined);
  const junkFinish3 = applyFinish(base, { timeMs: 1000 });
  check(junkFinish.records === base && junkFinish2.records === base && junkFinish3.records === base,
    'a missing/malformed finish payload is ignored');

  // An unrecognized medal string is treated as "no medal": the first finish
  // still records the time; a stored medal is never overwritten by it.
  const weirdMedalFirst = applyFinish({}, { eventId: 'blitz-tower', timeMs: 5000, medal: 'platinum' });
  check(deepEqual(weirdMedalFirst.records, { 'blitz-tower': { bestTimeMs: 5000 } }),
    'an unknown medal string is treated as no medal');
  const weirdMedalOver = applyFinish(
    { 'blitz-tower': { bestTimeMs: 9000, bestMedal: 'gold' } },
    { eventId: 'blitz-tower', timeMs: 5000, medal: 'platinum' }
  );
  check(weirdMedalOver.records['blitz-tower'].bestMedal === 'gold' &&
      weirdMedalOver.records['blitz-tower'].bestTimeMs === 5000,
    'an unknown medal string never overwrites a stored medal');
}

/* ------------------------------------------------------------------ */
/* f. Immutability: the input object is untouched                      */
/* ------------------------------------------------------------------ */

section('f. applyFinish never mutates its input');
{
  const base = {
    'blitz-downtown': { bestTimeMs: 40000, bestMedal: 'silver' },
    'blitz-riverside': { bestTimeMs: 150000, bestMedal: 'bronze' },
  };
  const snapshot = JSON.parse(JSON.stringify(base));
  const downtownEntry = base['blitz-downtown'];
  const riversideEntry = base['blitz-riverside'];

  const outcome = applyFinish(base, { eventId: 'blitz-downtown', timeMs: 30000, medal: 'gold' });
  check(deepEqual(base, snapshot), 'the input map is deep-equal to its pre-call state');
  check(base['blitz-downtown'] === downtownEntry && base['blitz-riverside'] === riversideEntry,
    'the input entries are the same objects (no in-place writes)');
  check(outcome.records !== base, 'the output is a NEW top-level object');
  check(outcome.records['blitz-riverside'] === riversideEntry,
    'untouched events share their entry object (shallow copy)');

  // And applying onto the OUTPUT leaves THAT untouched too (chaining).
  const chained = applyFinish(outcome.records, { eventId: 'blitz-downtown', timeMs: 45000, medal: 'bronze' });
  check(deepEqual(outcome.records, { 'blitz-downtown': { bestTimeMs: 30000, bestMedal: 'gold' }, 'blitz-riverside': riversideEntry }),
    'the intermediate map is intact after chaining');
  check(chained.records['blitz-downtown'].bestTimeMs === 30000,
    'the chained slower finish kept the record time');
}

/* ------------------------------------------------------------------ */
/* g. Full persistence round-trip through the save blob                */
/* ------------------------------------------------------------------ */

section('g. applyFinish -> saveSave -> loadSave round-trips the records');
{
  const fake = makeFakeStorage();
  const settings = { volume: 0.5, muted: false, quality: 'high' };

  // Two finishes folded through applyFinish, then one whole-blob write.
  const first = applyFinish({}, { eventId: 'blitz-downtown', timeMs: 40000, medal: 'bronze' });
  const second = applyFinish(first.records, { eventId: 'blitz-downtown', timeMs: 39000, medal: 'gold' });
  check(saveSave({ settings, records: second.records }, fake.store) === true, 'saveSave reports success');

  const loaded = loadSave(fake.store);
  check(deepEqual(loaded.records, second.records), 'loadSave returns the exact applied records');
  check(deepEqual(loaded.settings, settings), 'the settings half survives alongside');
  check(loaded.records['blitz-downtown'].bestTimeMs === 39000 &&
      loaded.records['blitz-downtown'].bestMedal === 'gold',
    'the folded result is the record run (39000, gold)');

  // A third finish applied to the LOADED map keeps the chain consistent.
  const third = applyFinish(loaded.records, { eventId: 'blitz-tower', timeMs: 70000, medal: 'silver' });
  saveSave({ settings: loaded.settings, records: third.records }, fake.store);
  check(deepEqual(loadSave(fake.store).records, third.records),
    're-apply on the loaded map round-trips again');
}

/* ------------------------------------------------------------------ */
/* h. Corrupt stored records -> defaults -> first finish cleans them   */
/* ------------------------------------------------------------------ */

section('h. corrupt stored records load as defaults; the first finish writes a clean blob');
{
  const fake = makeFakeStorage();
  fake.setRaw('{"records": "not-a-map", "settings": {"volume": 0.5}}');
  const loaded = loadSave(fake.store);
  check(deepEqual(loaded.records, {}), 'a corrupt records half loads as an empty map');

  // First finish after the corrupt load: applyFinish + saveSave overwrite
  // the bad data with exactly the known schema.
  const outcome = applyFinish(loaded.records, { eventId: 'blitz-downtown', timeMs: 41234, medal: 'gold' });
  saveSave({ settings: loaded.settings, records: outcome.records }, fake.store);
  const parsed = JSON.parse(fake.dump());
  check(deepEqual(parsed.records, { 'blitz-downtown': { bestTimeMs: 41234, bestMedal: 'gold' } }),
    'the stored blob now holds the clean record entry');
  check(deepEqual(Object.keys(parsed), ['settings', 'records']),
    'the stored blob is exactly { settings, records } (junk gone)');

  // And the corrupted-but-parseable variant (records as an array) too.
  const fake2 = makeFakeStorage();
  fake2.setRaw('{"records": [1, 2]}');
  const loaded2 = loadSave(fake2.store);
  const outcome2 = applyFinish(loaded2.records, { eventId: 'blitz-tower', timeMs: 60000, medal: null });
  saveSave({ settings: loaded2.settings, records: outcome2.records }, fake2.store);
  check(deepEqual(loadSave(fake2.store).records, { 'blitz-tower': { bestTimeMs: 60000 } }),
    'array records degrade to an empty map and the next finish writes cleanly');
}

/* ------------------------------------------------------------------ */
/* i. Results screen: NEW RECORD badge + medal tint (minimal DOM stub) */
/* ------------------------------------------------------------------ */

section('i. results screen shows the NEW RECORD badge and tints the medal');
{
  /**
   * Minimal element stub (save-test pattern): records listeners, plain
   * style object, settable textContent.
   * @param {string} tag Tag name.
   * @returns {object} The stub element.
   */
  function makeElement(tag) {
    const listeners = new Map();
    return {
      tagName: String(tag).toUpperCase(),
      style: {},
      textContent: '',
      value: '',
      append(...args) {
        for (const a of args) if (typeof a === 'object') this.children.push(a);
      },
      appendChild(child) {
        this.children.push(child);
        return child;
      },
      children: [],
      setAttribute() {},
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      removeEventListener() {},
      fire(type, event = {}) {
        for (const fn of listeners.get(type) ?? []) fn({ target: this, ...event });
      },
    };
  }

  globalThis.document = {
    createElement(tag) {
      return makeElement(tag);
    },
  };
  const mount = makeElement('body');
  const rs = createResultsScreen({
    onRetry: () => {},
    onMenu: () => {},
    mount,
  });

  // A record win: badge visible, medal tinted, best shows the new record.
  rs.show({
    eventName: 'BLITZ · DOWNTOWN SPRINT',
    eventId: 'blitz-downtown',
    timeMs: 30000,
    medal: 'gold',
    bestTimeMs: 30000,
    bestMedal: 'gold',
    isNewBest: true,
  });
  check(rs.slots.record.textContent === 'NEW RECORD', 'the badge element reads NEW RECORD');
  check(rs.slots.record.style.display === 'inline-block', 'isNewBest shows the badge');
  check(rs.slots.medal.textContent === 'GOLD', 'medal text stays the plain uppercased name');
  check(rs.slots.medal.style.color === MEDAL_COLORS.gold, 'the medal slot is tinted gold');
  check(rs.slots.best.textContent === formatRecordTime(30000), 'the BEST slot shows the standing best');
  check(rs.slots.time.textContent === formatRecordTime(30000), 'the TIME slot shows the finish');

  // A non-record win: badge hidden, best shows the kept record.
  rs.show({ timeMs: 35000, medal: 'silver', bestTimeMs: 30000, isNewBest: false });
  check(rs.slots.record.style.display === 'none', 'a non-record win hides the badge');
  check(rs.slots.best.textContent === formatRecordTime(30000), 'the kept best is displayed');
  check(rs.slots.medal.style.color === MEDAL_COLORS.silver, 'the medal tint follows the medal');

  // No isNewBest field at all (the pre-5.5 payload shape): badge hidden.
  rs.show({ timeMs: 35000, medal: 'bronze' });
  check(rs.slots.record.style.display === 'none', 'missing isNewBest keeps the badge hidden');

  // The failure variant NEVER calls out records, even with isNewBest set.
  rs.show({ timeMs: 66500, medal: null, isNewBest: true, failed: true });
  check(rs.slots.title.textContent === 'TIME UP' && rs.slots.record.style.display === 'none',
    'the failure variant never shows the NEW RECORD badge');

  delete globalThis.document;
}

console.log(`\nrecords-test: ${checks - failed}/${checks} assertions passed`);
if (failed > 0) {
  console.log(`records-test: ${failed} FAILED`);
  process.exit(1);
}
console.log('records-test: ALL PASS');
