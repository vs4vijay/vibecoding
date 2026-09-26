#!/usr/bin/env node
/**
 * Scripted verification harness for src/game/save.js + the DOM-free pieces
 * of src/ui/settings-screen.js (task 5.1).
 *
 * Runs under plain node (no browser, no jsdom): a fake in-memory storage
 * (and a throwing storage for the failure paths) stands in for localStorage,
 * which node does not define. Assertions, per the task:
 *
 *   1. defaults            -> DEFAULT_SETTINGS shape/values, frozen; a missing
 *                             key loads as { settings: defaults, records: {} }
 *   2. corrupt data        -> unparsable JSON, JSON null/array/string, a
 *                             throwing getItem, and a non-object payload all
 *                             load as defaults WITHOUT throwing
 *   3. partial shapes      -> wrong types fall back per field (volume "loud",
 *                             quality 'ultra', muted 1), valid fields survive
 *                             (volume 0.3, quality 'high'), volume clamps to
 *                             [0,1], unknown top-level shapes are tolerated
 *   4. round-trip          -> saveSave -> loadSave returns equal data; the
 *                             write is a WHOLE-blob replace (second save wins)
 *   5. schema policy       -> unknown extra fields in a stored blob are
 *                             DROPPED deterministically (documented choice);
 *                             __proto__ keys can never pollute the result
 *   6. records             -> { bestTimeMs, bestMedal } entries survive a
 *                             round-trip; invalid entries/fields are dropped
 *   7. failure safety      -> a throwing setItem (quota) makes saveSave
 *                             return false without throwing
 *   8. default storage     -> with NO injected storage (localStorage is
 *                             undefined here) save/load round-trip through
 *                             the in-memory fallback
 *   9. settings screen     -> the module imports without touching the DOM,
 *                             exports createSettingsScreen/createSettingsWriter,
 *                             and the debounced writer coalesces queues into
 *                             one save, flushes on demand, flush-on-dispose,
 *                             and reports pending state
 *
 * Run: node scripts/save-test.mjs   (plain node, no dependencies)
 */
import {
  DEFAULT_SETTINGS,
  SAVE_KEY,
  SAVE_SCHEMA_VERSION,
  loadSave,
  saveSave,
  sanitizeSettings,
  sanitizeRecords,
} from '../src/game/save.js';
import {
  createSettingsScreen,
  createSettingsWriter,
  SETTINGS_WRITE_DEBOUNCE_MS,
} from '../src/ui/settings-screen.js';

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
 * Wait for a timeout (used for the debounced writer's real timer).
 * @param {number} ms Milliseconds to wait.
 * @returns {Promise<void>} Resolves after the delay.
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Deep-equal for plain JSON data (settings/records shapes only).
 * @param {unknown} a Left value.
 * @param {unknown} b Right value.
 * @returns {boolean} Whether the values are structurally equal.
 */
function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Build a fresh in-memory storage fake (localStorage stand-in).
 * @returns {{ store: { getItem: (k: string) => string | null, setItem: (k: string, v: string) => void, removeItem: (k: string) => void }, dump: () => string | null, setRaw: (v: string | null) => void }} The fake plus read/write helpers.
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
      removeItem(key) {
        map.delete(key);
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
/* 1. Defaults + missing key                                           */
/* ------------------------------------------------------------------ */

section('1. defaults and a missing key load as defaults');
{
  check(SAVE_KEY === 'midtown-blitz.save.v1', `the single namespaced key is "${SAVE_KEY}"`);
  check(SAVE_SCHEMA_VERSION === 1, 'schema version 1 (key suffix carries it)');
  check(
    deepEqual({ ...DEFAULT_SETTINGS }, { volume: 0.8, muted: false, quality: 'medium' }),
    'DEFAULT_SETTINGS = { volume 0.8, muted false, quality medium }'
  );
  check(Object.isFrozen(DEFAULT_SETTINGS), 'DEFAULT_SETTINGS is frozen');

  const missing = makeFakeStorage();
  let data = null;
  let threw = false;
  try {
    data = loadSave(missing.store);
  } catch {
    threw = true;
  }
  check(!threw, 'loadSave never throws on a missing key');
  check(deepEqual(data.settings, { ...DEFAULT_SETTINGS }), 'missing key -> default settings');
  check(deepEqual(data.records, {}), 'missing key -> empty records');
  check(
    deepEqual(Object.keys(data), ['settings', 'records']),
    'the loaded blob is exactly { settings, records }'
  );
}

/* ------------------------------------------------------------------ */
/* 2. Corrupt data -> defaults, never throws                           */
/* ------------------------------------------------------------------ */

section('2. corrupt data loads as defaults without throwing');
{
  const corruptCases = [
    ['unparsable JSON', '{not json at all'],
    ['truncated JSON', '{"settings": {"volume": 0.'],
    ['JSON null', 'null'],
    ['JSON array', '[1, 2, 3]'],
    ['JSON string', '"garbage"'],
    ['JSON number', '42'],
  ];
  for (const [name, raw] of corruptCases) {
    const fake = makeFakeStorage();
    fake.setRaw(raw);
    let threw = false;
    let data = null;
    try {
      data = loadSave(fake.store);
    } catch {
      threw = true;
    }
    check(!threw, `${name}: loadSave does not throw`);
    check(
      threw === false &&
        deepEqual(data.settings, { ...DEFAULT_SETTINGS }) &&
        deepEqual(data.records, {}),
      `${name}: defaults come back (${name})`
    );
  }

  // A storage whose getItem throws (storage disabled by privacy settings).
  const throwing = {
    getItem() {
      throw new Error('SecurityError');
    },
    setItem() {
      throw new Error('SecurityError');
    },
  };
  let threw = false;
  let data = null;
  try {
    data = loadSave(throwing);
  } catch {
    threw = true;
  }
  check(!threw && deepEqual(data.settings, { ...DEFAULT_SETTINGS }),
    'a throwing getItem -> defaults, no throw');
}

/* ------------------------------------------------------------------ */
/* 3. Partial shapes -> per-field defaults, valid fields kept          */
/* ------------------------------------------------------------------ */

section('3. partial shapes sanitize per field and keep valid values');
{
  // All-wrong settings (the exact case from the task): volume "loud",
  // quality 'ultra', muted 1.
  const fake = makeFakeStorage();
  fake.setRaw(
    JSON.stringify({ settings: { volume: 'loud', quality: 'ultra', muted: 1 } })
  );
  const data = loadSave(fake.store);
  check(data.settings.volume === DEFAULT_SETTINGS.volume, 'volume "loud" -> default volume');
  check(data.settings.quality === 'medium', "quality 'ultra' -> default 'medium'");
  check(data.settings.muted === false, 'muted 1 (not a boolean) -> default false');

  // Mixed: valid fields survive, missing/invalid ones default.
  const mixed = sanitizeSettings({ volume: 0.3, quality: 'high' });
  check(mixed.volume === 0.3, 'valid volume 0.3 is kept');
  check(mixed.quality === 'high', "valid quality 'high' is kept");
  check(mixed.muted === false, 'missing muted -> default false');

  // Volume clamps to [0, 1] when type-valid but out of range (matches
  // audio.setVolume); NaN/non-numbers fall back to the default.
  check(sanitizeSettings({ volume: 1.5 }).volume === 1, 'volume 1.5 clamps to 1');
  check(sanitizeSettings({ volume: -0.1 }).volume === 0, 'volume -0.1 clamps to 0');
  check(
    sanitizeSettings({ volume: Number.NaN }).volume === DEFAULT_SETTINGS.volume,
    'NaN volume -> default'
  );
  check(
    sanitizeSettings({ volume: 'loud' }).volume === DEFAULT_SETTINGS.volume,
    'string volume -> default'
  );

  // Wrong containers at any level degrade to per-field defaults.
  check(
    deepEqual(sanitizeSettings(null), { ...DEFAULT_SETTINGS }),
    'settings null -> defaults'
  );
  check(
    deepEqual(sanitizeSettings([1]), { ...DEFAULT_SETTINGS }),
    'settings array -> defaults'
  );
  check(deepEqual(loadSave(makeFakeStorage().store).settings, { ...DEFAULT_SETTINGS }),
    'a fresh fake (no key) still loads defaults');

  // Top-level partial: {} and missing sub-objects.
  const emptyBlob = makeFakeStorage();
  emptyBlob.setRaw('{}');
  const emptyData = loadSave(emptyBlob.store);
  check(deepEqual(emptyData.settings, { ...DEFAULT_SETTINGS }) && deepEqual(emptyData.records, {}),
    'blob {} -> defaults for both halves');
}

/* ------------------------------------------------------------------ */
/* 4. Round-trip + whole-blob replace                                  */
/* ------------------------------------------------------------------ */

section('4. save -> load round-trips; writes are whole-blob replaces');
{
  const fake = makeFakeStorage();
  const blob = {
    settings: { volume: 0.25, muted: true, quality: 'high' },
    records: { 'blitz-downtown': { bestTimeMs: 45123, bestMedal: 'gold' } },
  };
  check(saveSave(blob, fake.store) === true, 'saveSave returns true on success');
  const loaded = loadSave(fake.store);
  check(deepEqual(loaded.settings, blob.settings), 'settings survive the round-trip');
  check(deepEqual(loaded.records, blob.records), 'records survive the round-trip');

  // Whole-blob replace: a second save REPLACES everything, not a merge.
  saveSave({ settings: { volume: 0.9, muted: false, quality: 'low' }, records: {} }, fake.store);
  const second = loadSave(fake.store);
  check(second.settings.volume === 0.9 && second.settings.quality === 'low',
    'a second save replaces the settings wholesale');
  check(deepEqual(second.records, {}),
    'a second save with empty records clears the old records (whole-blob, not merge)');

  // The stored string is exactly the sanitized schema (parse-back check).
  const parsedBack = JSON.parse(fake.dump());
  check(
    deepEqual(Object.keys(parsedBack), ['settings', 'records']) &&
      deepEqual(Object.keys(parsedBack.settings), ['volume', 'muted', 'quality']),
    'the stored blob is exactly { settings: {volume,muted,quality}, records }'
  );
}

/* ------------------------------------------------------------------ */
/* 5. Schema policy: unknown fields dropped deterministically          */
/* ------------------------------------------------------------------ */

section('5. unknown extra fields are dropped deterministically (documented choice)');
{
  const fake = makeFakeStorage();
  fake.setRaw(
    JSON.stringify({
      settings: { volume: 0.5, muted: false, quality: 'low', colorTheme: 'neon', cheats: true },
      records: { 'e1': { bestTimeMs: 100, bestMedal: 'silver', carPaint: 'red' } },
      version: 99,
      sessionCount: 7,
    })
  );
  const data = loadSave(fake.store);
  check(
    deepEqual(Object.keys(data.settings), ['volume', 'muted', 'quality']) &&
      data.settings.volume === 0.5,
    'unknown settings fields are dropped, known ones kept'
  );
  check(
    deepEqual(Object.keys(data.records.e1), ['bestTimeMs', 'bestMedal']),
    'unknown fields inside record entries are dropped'
  );
  check(
    !('version' in data) && !('sessionCount' in data),
    'unknown top-level fields are dropped'
  );
  // Deterministic: loading twice gives the identical result, and a re-save
  // stores exactly the sanitized schema (corrupt data is cleaned on save).
  const again = loadSave(fake.store);
  check(deepEqual(data, again), 'two loads of the same blob agree (deterministic)');
  saveSave(data, fake.store);
  const reparsed = JSON.parse(fake.dump());
  check(
    !('cheats' in reparsed.settings) && !('version' in reparsed),
    're-saving writes only the known schema (bad data cleaned on next save)'
  );

  // Prototype-pollution keys in a hostile blob can never reach the result.
  const hostile = makeFakeStorage();
  hostile.setRaw(
    '{"records": {"__proto__": {"bestTimeMs": 1}, "ok": {"bestTimeMs": 5}}}'
  );
  const safe = loadSave(hostile.store);
  check(
    deepEqual(Object.keys(safe.records), ['ok']) &&
      safe.records.bestTimeMs === undefined &&
      Object.keys(safe.records).includes('__proto__') === false,
    '__proto__ record keys are skipped (no prototype pollution)'
  );
}

/* ------------------------------------------------------------------ */
/* 6. Records shape survives a round-trip; junk entries dropped        */
/* ------------------------------------------------------------------ */

section('6. records { bestTimeMs, bestMedal } survive; invalid entries drop');
{
  const records = {
    'blitz-downtown': { bestTimeMs: 45123, bestMedal: 'gold' },
    'blitz-crosstown': { bestTimeMs: 0, bestMedal: 'bronze' }, // 0 ms is valid (>= 0)
    'cruise-infinity': { bestTimeMs: 999999 }, // medal alone is optional
    'medal-only': { bestMedal: 'silver' }, // time alone is optional too
  };
  const fake = makeFakeStorage();
  saveSave({ settings: { ...DEFAULT_SETTINGS }, records }, fake.store);
  const loaded = loadSave(fake.store);
  check(deepEqual(loaded.records, records), 'valid record entries survive the round-trip');

  const junk = sanitizeRecords({
    negativeTime: { bestTimeMs: -5, bestMedal: 'gold' },
    stringTime: { bestTimeMs: 'fast' },
    notAnObject: 42,
    arrayEntry: [1],
    nullEntry: null,
  });
  check(
    deepEqual(junk, { negativeTime: { bestMedal: 'gold' } }),
    'entries with nothing valid drop entirely; an invalid field drops but its valid sibling stays'
  );
  check(
    deepEqual(sanitizeRecords({ a: { bestTimeMs: 10, bestMedal: 'platinum' } }), {
      a: { bestTimeMs: 10 },
    }),
    'a valid field next to an invalid one keeps only the valid field'
  );
  check(deepEqual(sanitizeRecords('nope'), {}), 'records string -> empty map');
  check(deepEqual(sanitizeRecords(['x']), {}), 'records array -> empty map');
}

/* ------------------------------------------------------------------ */
/* 7. saveSave failure safety (quota / disabled storage)               */
/* ------------------------------------------------------------------ */

section('7. a throwing setItem makes saveSave return false, never throw');
{
  const quota = {
    getItem: () => null,
    setItem() {
      throw new Error('QuotaExceededError');
    },
  };
  let threw = false;
  let result = null;
  try {
    result = saveSave({ settings: { ...DEFAULT_SETTINGS }, records: {} }, quota);
  } catch {
    threw = true;
  }
  check(!threw, 'saveSave does not throw when setItem throws');
  check(result === false, 'saveSave reports the failure as false');
}

/* ------------------------------------------------------------------ */
/* 8. Default storage path (no injection, no localStorage in node)     */
/* ------------------------------------------------------------------ */

section('8. un-injected calls use the in-memory fallback and round-trip');
{
  check(typeof localStorage === 'undefined', 'precondition: node has no localStorage');
  const blob = {
    settings: { volume: 0.42, muted: true, quality: 'medium' },
    records: { 'e1': { bestTimeMs: 1234, bestMedal: 'silver' } },
  };
  let ok = false;
  let loaded = null;
  try {
    ok = saveSave(blob);
    loaded = loadSave();
  } catch {
    ok = false;
  }
  check(ok === true, 'saveSave works with no injected storage');
  check(deepEqual(loaded.settings, blob.settings), 'loadSave reads the fallback storage back');
  check(deepEqual(loaded.records, blob.records), 'records round-trip through the fallback');
}

/* ------------------------------------------------------------------ */
/* 9. Settings screen module: DOM-free surface + debounced writer      */
/* ------------------------------------------------------------------ */

section('9. settings-screen module exports + debounced writer (DOM-free)');
{
  // The bare import above already proves the module has no import-time DOM
  // access (node defines no `document`).
  check(
    typeof createSettingsScreen === 'function' && typeof createSettingsWriter === 'function',
    'module exports createSettingsScreen + createSettingsWriter (no DOM touched at import)'
  );
  check(SETTINGS_WRITE_DEBOUNCE_MS === 250, `debounce default is ${SETTINGS_WRITE_DEBOUNCE_MS} ms`);

  // Debounce coalesces: two rapid queues -> exactly one save with the LAST
  // payload once the window elapses.
  {
    const saved = [];
    const w = createSettingsWriter({ save: (d) => saved.push(d), delayMs: 20 });
    w.queue({ n: 1 });
    w.queue({ n: 2 });
    check(w.hasPending() === true, 'hasPending is true while a write is scheduled');
    await sleep(45);
    check(saved.length === 1, 'two rapid queues coalesce into ONE save');
    check(deepEqual(saved[0], { n: 2 }), 'the coalesced save carries the LAST payload');
    check(w.hasPending() === false, 'hasPending clears after the write fires');
  }

  // Flush writes immediately and disarms the timer (no double write when the
  // window would have elapsed later); an idle flush is a no-op.
  {
    const saved = [];
    const w = createSettingsWriter({ save: (d) => saved.push(d), delayMs: 25 });
    w.queue({ n: 1 });
    w.flush();
    check(saved.length === 1 && deepEqual(saved[0], { n: 1 }), 'flush writes the pending payload immediately');
    check(w.hasPending() === false, 'flush clears the pending state');
    await sleep(45);
    check(saved.length === 1, 'the disarmed timer never double-writes');
    w.flush();
    check(saved.length === 1, 'an idle flush is a no-op');
  }

  // Dispose flushes (used on close) — the last change survives without
  // waiting for the window.
  {
    const saved = [];
    const w = createSettingsWriter({ save: (d) => saved.push(d), delayMs: 30000 });
    w.queue({ n: 7 });
    w.dispose();
    check(saved.length === 1 && deepEqual(saved[0], { n: 7 }), 'dispose flushes a pending write');
  }
}

/* ------------------------------------------------------------------ */
/* 10. Settings screen behavior against a minimal DOM stub             */
/* ------------------------------------------------------------------ */

section('10. settings screen drives apply + persist (minimal DOM stub)');
{
  /**
   * Minimal element stub: records listeners so the harness can fire events,
   * plain-object style, settable textContent/value.
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
      type: '',
      min: '',
      max: '',
      step: '',
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
      /**
       * Fire a DOM event type at this element.
       * @param {string} type Event type.
       * @param {object} [event] Extra event fields (e.g. a target).
       * @returns {void}
       */
      fire(type, event = {}) {
        for (const fn of listeners.get(type) ?? []) fn({ target: this, ...event });
      },
    };
  }

  const created = [];
  const mount = makeElement('body');
  globalThis.document = {
    createElement(tag) {
      const el = makeElement(tag);
      created.push(el);
      return el;
    },
  };

  const applied = { volume: [], muted: [], quality: [] };
  const persisted = [];
  const closed = [];
  const screen = createSettingsScreen({
    settings: { volume: 0.8, muted: false, quality: 'medium' },
    getSettings: () => ({ volume: 0.8, muted: false, quality: 'medium' }),
    onApplyVolume: (v) => applied.volume.push(v),
    onApplyMuted: (m) => applied.muted.push(m),
    onApplyQuality: (q) => applied.quality.push(q),
    persist: (s) => persisted.push(s),
    onClose: () => closed.push(true),
    mount,
    keyTarget: null, // Escape wiring needs a real EventTarget; not under test here
  });

  // Initial render from the passed settings.
  const slider = created.find((e) => e.tagName === 'INPUT');
  check(!!slider && slider.value === '80' && slider.max === '100',
    'volume slider renders 0-100 with the initial 80%');
  check(!!created.some((e) => e.textContent === '80%'), 'the % readout shows the initial volume');
  check(screen.isOpen() === false, 'the panel starts hidden');
  check(mount.children.includes(screen.root), 'the panel is mounted on the given mount node');

  // open() shows it; close() hides it and notifies onClose.
  screen.open();
  check(screen.isOpen() === true && screen.root.style.display === 'block', 'open() shows the panel');
  screen.close();
  check(screen.isOpen() === false && screen.root.style.display === 'none', 'close() hides the panel');
  check(closed.length === 1, 'close() notifies onClose exactly once');
  screen.close();
  check(closed.length === 1, 'closing an already-closed panel is a no-op');

  // Volume slider input -> live apply + persist with the merged settings.
  screen.open();
  slider.value = '30';
  slider.fire('input');
  check(applied.volume.length === 1 && applied.volume[0] === 0.3,
    'slider input applies volume 0.30 live');
  check(
    persisted.length === 1 &&
      deepEqual(persisted[0], { volume: 0.3, muted: false, quality: 'medium' }),
    'slider input persists the FULL merged settings object'
  );

  // Mute toggle click -> live apply + persist.
  const muteButton = created.find((e) => e.tagName === 'BUTTON' && /OFF|ON/.test(e.textContent));
  muteButton.fire('click');
  check(applied.muted.length === 1 && applied.muted[0] === true, 'mute click applies muted=true live');
  check(muteButton.textContent === 'ON', 'the mute button label flips to ON');
  check(persisted[1].muted === true, 'mute click persists muted=true');

  // Quality chip click -> live apply + persist (the one quality path entry).
  const lowChip = created.find((e) => e.tagName === 'BUTTON' && e.textContent === 'LOW');
  lowChip.fire('click');
  check(applied.quality.length === 1 && applied.quality[0] === 'low', 'chip click applies quality low');
  check(persisted[2].quality === 'low', 'chip click persists quality low');

  // Reset to defaults: all three apply paths re-fire with DEFAULT_SETTINGS.
  const resetButton = created.find((e) => e.textContent === 'RESET TO DEFAULTS');
  resetButton.fire('click');
  check(
    applied.volume[applied.volume.length - 1] === DEFAULT_SETTINGS.volume &&
      applied.muted[applied.muted.length - 1] === DEFAULT_SETTINGS.muted &&
      applied.quality[applied.quality.length - 1] === DEFAULT_SETTINGS.quality,
    'reset re-applies every default through the live paths'
  );
  check(slider.value === '80' && muteButton.textContent === 'OFF',
    'reset re-renders the controls (slider 80%, mute OFF)');

  // sync() reflects external changes without emitting or persisting.
  const applyCountBefore = applied.volume.length + applied.muted.length + applied.quality.length;
  const persistCountBefore = persisted.length;
  screen.sync({ volume: 0.1, muted: true, quality: 'high' });
  check(
    applied.volume.length + applied.muted.length + applied.quality.length === applyCountBefore &&
      persisted.length === persistCountBefore,
    'sync() emits no changes and persists nothing'
  );
  check(slider.value === '10' && muteButton.textContent === 'ON', 'sync() re-renders the controls');

  // Flush-on-close choreography (as main.js wires it): a change queues into
  // the shared debounced writer; close() flushes it so the blob lands.
  {
    const savedBlobs = [];
    const writer = createSettingsWriter({
      save: (data) => savedBlobs.push(data),
      delayMs: 60000, // would never fire naturally in this test
    });
    const screen2 = createSettingsScreen({
      settings: { volume: 0.8, muted: false, quality: 'medium' },
      onApplyVolume: () => {},
      onApplyMuted: () => {},
      onApplyQuality: () => {},
      persist: (s) => writer.queue({ settings: s, records: { e1: { bestTimeMs: 1 } } }),
      onClose: () => writer.flush(),
      mount,
      keyTarget: null,
    });
    screen2.open();
    const slider2 = created.filter((e) => e.tagName === 'INPUT')[1];
    slider2.value = '55';
    slider2.fire('input');
    check(writer.hasPending() === true, 'a change leaves a pending debounced write');
    screen2.close();
    check(
      savedBlobs.length === 1 &&
        savedBlobs[0].settings.volume === 0.55 &&
        deepEqual(savedBlobs[0].records, { e1: { bestTimeMs: 1 } }),
      'close() flushes the writer: one blob with the final settings + records intact'
    );
  }

  delete globalThis.document;
}

console.log(`\nsave-test: ${checks - failed}/${checks} assertions passed`);
if (failed > 0) {
  console.log(`save-test: ${failed} FAILED`);
  process.exit(1);
}
console.log('save-test: ALL PASS');
