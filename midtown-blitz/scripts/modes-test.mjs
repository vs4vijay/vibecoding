#!/usr/bin/env node
/**
 * Mode machine + menus harness (Midtown Blitz — task 5.2).
 *
 * Plain node (no browser, no jsdom): a minimal DOM element stub (the
 * save-test pattern) stands in for the overlay screens' elements, and the
 * mode machine runs as the pure logic it is. Assertions, per the task:
 *
 *   A. machine      -> legal transitions along the whole nav table
 *                      (menu→racing→paused→resume/restart→menu, racing→results
 *                      →retry/menu), illegal ones refused without side effects
 *                      (pause from menu, results from paused, same-mode,
 *                      unknown), hooks fired in exit→enter order with the
 *                      right payloads
 *   B. teardown     -> the cleanup registry runs every cleanup EXACTLY once
 *                      on exit, LIFO, nested registrations included; manual
 *                      cancel prevents the run; the registry is empty after
 *                      every exit; a refused transition runs nothing;
 *                      onCleanup before the first mode throws
 *   C. main menu    -> renders the title, 3 Blitz cards + cruise card from the
 *                      records map (best time + medal, em-dash placeholders),
 *                      setRecords re-renders, clicks fire onStartMode with the
 *                      right ids and onOpenSettings
 *   D. pause menu   -> show/hide/open, RESUME / RESTART / QUIT clicks fire
 *   E. results      -> placeholder slots render data (or '—'), RETRY / MENU
 *                      clicks fire, show/hide
 *   F. formatting   -> formatRecordTime edges (m:ss.mmm, non-finite → '—')
 *
 * Run: node scripts/modes-test.mjs   (plain node, no dependencies)
 */
import { createModeMachine, MODE_NAMES, MODE_TRANSITIONS } from '../src/game/modes.js';
import {
  createMainMenu,
  MENU_EVENTS,
  CRUISE_EVENT_ID,
  formatRecordTime,
} from '../src/ui/main-menu.js';
import { createPauseMenu } from '../src/ui/pause-menu.js';
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
 * Deep-equal for plain JSON data (hook payloads only).
 * @param {unknown} a Left value.
 * @param {unknown} b Right value.
 * @returns {boolean} Whether the values are structurally equal.
 */
function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// --- minimal DOM stub (save-test pattern) -----------------------------------

/**
 * cssText-aware inline-style stub: assignments through `style.cssText`
 * parse into declarations, and later `style.prop = value` writes (and reads)
 * hit the same map — so the harness can assert e.g. `style.display`.
 * @returns {object} A CSSStyleDeclaration-like stub.
 */
function makeStyle() {
  const decls = new Map();
  const base = {
    get cssText() {
      return [...decls.entries()].map(([k, v]) => `${k}:${v}`).join(';');
    },
    set cssText(text) {
      decls.clear();
      for (const part of String(text).split(';')) {
        const i = part.indexOf(':');
        if (i > 0) decls.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
      }
    },
  };
  return new Proxy(base, {
    get(target, prop) {
      if (prop === 'cssText') return target.cssText;
      return typeof prop === 'string' ? decls.get(prop) ?? '' : undefined;
    },
    set(target, prop, value) {
      if (prop === 'cssText') {
        target.cssText = value;
      } else {
        decls.set(String(prop), String(value));
      }
      return true;
    },
  });
}

/**
 * Element stub good enough for the overlay screens (inline styles, child
 * lists, listeners, text).
 * @param {string} tagName Tag name.
 * @returns {object} The element stub.
 */
function makeElement(tagName) {
  const listeners = new Map();
  const el = {
    tagName: String(tagName).toUpperCase(),
    style: makeStyle(),
    children: [],
    textContent: '',
    value: '',
    type: '',
    setAttribute() {},
    getAttribute() {
      return null;
    },
    appendChild(child) {
      el.children.push(child);
      return child;
    },
    append(...args) {
      for (const a of args) if (typeof a === 'object') el.children.push(a);
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener() {},
    remove() {},
    fire(type, event) {
      for (const fn of listeners.get(type) ?? []) fn(event);
    },
  };
  return el;
}

globalThis.document = {
  createElement: makeElement,
  body: makeElement('body'),
};

/**
 * Concatenated textContent of an element subtree (the stub keeps parent
 * textContent separate from children, so walk them).
 * @param {object} el Element stub.
 * @returns {string} All text in the subtree.
 */
function collectText(el) {
  let out = typeof el.textContent === 'string' ? el.textContent : '';
  for (const child of el.children) out += collectText(child);
  return out;
}

// ===========================================================================
// A. mode machine — transitions and guards
// ===========================================================================
section('A. machine transitions');

{
  const m = createModeMachine();
  check(MODE_NAMES.length === 4, 'four mode names');
  check(
    Object.isFrozen(MODE_NAMES) && Object.isFrozen(MODE_TRANSITIONS),
    'mode tables are frozen'
  );
  check(m.current === null, 'machine starts with no active mode');
  check(m.data === null, 'machine starts with no data');
  check(m.pendingCleanups === 0, 'registry starts empty');
  check(m.enterMode('bogus') === false, 'unknown mode refused');
  check(m.current === null, 'refusal left machine untouched');

  // The full legal walk: menu -> racing -> paused -> (resume) -> paused ->
  // (quit) -> menu -> racing -> results -> (retry) -> racing -> results ->
  // (menu). Data rides along each entry.
  check(m.canTransition(null, 'menu'), 'boot may enter any first mode');
  check(m.canTransition('menu', 'racing'), 'menu -> racing legal');
  check(m.canTransition('racing', 'menu'), 'racing -> menu legal (future abort)');
  check(!m.canTransition('menu', 'menu'), 'same-mode re-entry illegal');
  check(!m.canTransition('menu', 'paused'), 'pause from menu illegal');
  check(!m.canTransition('menu', 'results'), 'results from menu illegal');
  check(!m.canTransition('paused', 'results'), 'results from paused illegal');
  check(!m.canTransition('results', 'paused'), 'paused from results illegal');
  check(!m.canTransition('paused', 'bogus'), 'unknown target illegal');

  check(m.enterMode('menu') === true, 'boot enters menu');
  check(m.current === 'menu' && m.data === null, 'menu active, no data');

  check(m.enterMode('paused') === false, 'ILLEGAL menu -> paused refused');
  check(m.current === 'menu', 'still menu after refusal');
  check(m.enterMode('results') === false, 'ILLEGAL menu -> results refused');
  check(m.enterMode('menu') === false, 'ILLEGAL menu -> menu refused');

  check(m.enterMode('racing', { event: 'blitz-downtown', resume: false }) === true,
    'menu -> racing (start event)');
  check(m.data && m.data.event === 'blitz-downtown' && m.data.resume === false,
    'racing entry data carries the event');
  check(m.enterMode('racing') === false, 'ILLEGAL racing -> racing refused');

  check(m.enterMode('paused', { reason: 'esc' }) === true, 'racing -> paused');
  check(m.enterMode('results') === false, 'ILLEGAL paused -> results refused');
  check(m.enterMode('racing', { resume: true, event: 'blitz-downtown' }) === true,
    'paused -> racing (resume)');
  check(m.data && m.data.resume === true, 'resume entry flagged resume:true');

  check(m.enterMode('paused', { reason: 'esc' }) === true, 'racing -> paused again');
  check(m.enterMode('menu') === true, 'paused -> menu (quit)');
  check(m.enterMode('racing', { event: 'cruise', resume: false }) === true,
    'menu -> racing (cruise)');
  check(m.enterMode('results', { timeMs: 1000 }) === true, 'racing -> results');
  check(m.enterMode('racing', { event: 'cruise', resume: false }) === true,
    'results -> racing (retry)');
  check(m.enterMode('results', { timeMs: 2000 }) === true, 'racing -> results again');
  check(m.enterMode('menu') === true, 'results -> menu');
}

// --- hook order + payloads ---------------------------------------------------
section('A2. machine hooks');

{
  const events = [];
  const m = createModeMachine({
    onExit: (mode, info) => events.push(['exit', mode, info.to]),
    onEnter: (mode, info) => events.push(['enter', mode, info.from, info.data]),
  });
  m.enterMode('menu');
  m.enterMode('racing', { event: 'x' });
  check(deepEqual(events, [
    ['enter', 'menu', null, null],
    ['exit', 'menu', 'racing'],
    ['enter', 'racing', 'menu', { event: 'x' }],
  ]), 'hooks fire exit-then-enter with from/to/data');
}

// ===========================================================================
// B. teardown registry
// ===========================================================================
section('B. teardown registry');

{
  const m = createModeMachine();
  m.enterMode('menu');

  let threw = null;
  try {
    createModeMachine().onCleanup(() => {});
  } catch (e) {
    threw = e;
  }
  check(!!threw, 'onCleanup before the first mode throws');

  m.enterMode('racing', {});
  const ran = [];
  m.onCleanup(() => ran.push('a1'));
  m.onCleanup(() => ran.push('a2'));
  m.onCleanup(() => ran.push('a3'));
  const cancel = m.onCleanup(() => ran.push('cancelled'));
  cancel();
  check(m.pendingCleanups === 3, 'cancel removed its entry from the registry');

  m.enterMode('paused', {});
  check(deepEqual(ran, ['a3', 'a2', 'a1']), 'cleanups ran LIFO exactly once; cancelled never ran');
  check(m.pendingCleanups === 0, 'registry empty after exit');
  check(m.lastFlushed === 3, 'lastFlushed counts the flush');

  // Refused transitions run nothing.
  m.onCleanup(() => ran.push('paused-cleanup'));
  ran.length = 0;
  check(m.enterMode('results') === false, 'paused -> results refused');
  check(ran.length === 0 && m.pendingCleanups === 1, 'refusal ran no cleanups');
  check(m.lastFlushed === 3, 'refusal did not flush');

  // Each mode gets a fresh registry: racing's second visit starts empty.
  m.enterMode('racing', {});
  check(m.lastFlushed === 1 && m.pendingCleanups === 0,
    'the exit flushed the previous mode; the new mode starts empty');
  m.onCleanup(() => ran.push('racing-2'));
  m.enterMode('menu');
  check(deepEqual(ran, ['paused-cleanup', 'racing-2']),
    'each mode teardown runs on its own exit, not again later');
  check(m.lastFlushed === 1, 'lastFlushed reflects the latest exit only');
}

{
  // Nested: a cleanup that registers another cleanup during the flush runs
  // in the same flush, exactly once (the "timer teardown cancels a child"
  // pattern).
  const m = createModeMachine();
  m.enterMode('menu');
  m.enterMode('racing', {});
  const ran = [];
  m.onCleanup(() => {
    ran.push('outer');
    m.onCleanup(() => ran.push('inner-from-outer'));
  });
  m.onCleanup(() => ran.push('registered-before'));
  m.enterMode('menu');
  check(deepEqual(ran, ['registered-before', 'outer', 'inner-from-outer']),
    'nested cleanup registered during the flush runs exactly once');
  check(m.pendingCleanups === 0, 'registry fully drained after nested flush');
}

// ===========================================================================
// C. main menu screen
// ===========================================================================
section('C. main menu');

{
  const mount = makeElement('div');
  const started = [];
  let settingsOpened = 0;
  const menu = createMainMenu({
    records: { 'blitz-downtown': { bestTimeMs: 91234, bestMedal: 'gold' } },
    onStartMode: (id) => started.push(id),
    onOpenSettings: () => {
      settingsOpened += 1;
    },
    mount,
  });

  check(mount.children.includes(menu.root), 'menu root mounted');
  check(!menu.isOpen() && menu.root.style.display === 'none', 'menu starts hidden');
  menu.show();
  check(menu.isOpen() && menu.root.style.display === 'flex', 'show() opens the overlay');

  const text = collectText(menu.root);
  check(text.includes('MIDTOWN BLITZ'), 'gradient title rendered');
  check(text.includes('SETTINGS'), 'settings button rendered');
  check(MENU_EVENTS.length === 3, 'three Blitz events defined');
  check(
    Object.keys(menu.cardButtons).length === MENU_EVENTS.length + 1 &&
      !!menu.cardButtons[CRUISE_EVENT_ID],
    'card per event + cruise'
  );

  const downtownText = collectText(menu.cardButtons['blitz-downtown']);
  check(downtownText.includes('1:31.234'), `best time rendered (got "${downtownText}")`);
  check(downtownText.includes('GOLD'), 'medal rendered uppercased');
  const towerText = collectText(menu.cardButtons['blitz-tower']);
  check(towerText.includes('—') && towerText.includes('NO RECORD'),
    'missing records render placeholders');
  check(collectText(menu.cardButtons[CRUISE_EVENT_ID]).includes('FREE ROAM'),
    'cruise card rendered');

  // setRecords re-render.
  menu.setRecords({
    'blitz-riverside': { bestTimeMs: 4500, bestMedal: 'bronze' },
    'blitz-downtown': {},
  });
  check(collectText(menu.cardButtons['blitz-riverside']).includes('0:04.500'),
    'setRecords renders a new best time');
  check(collectText(menu.cardButtons['blitz-riverside']).includes('BRONZE'),
    'setRecords renders a new medal');
  check(collectText(menu.cardButtons['blitz-downtown']).includes('—'),
    'cleared record falls back to placeholder');

  // Clicks.
  menu.cardButtons[CRUISE_EVENT_ID].fire('click', {});
  menu.cardButtons['blitz-tower'].fire('click', {});
  check(deepEqual(started, [CRUISE_EVENT_ID, 'blitz-tower']),
    'card clicks fire onStartMode with the right ids');
  menu.settingsButton.fire('click', {});
  check(settingsOpened === 1, 'settings click fires onOpenSettings');

  menu.hide();
  check(!menu.isOpen() && menu.root.style.display === 'none', 'hide() closes the overlay');
}

// ===========================================================================
// D. pause menu screen
// ===========================================================================
section('D. pause menu');

{
  const mount = makeElement('div');
  const fired = { resume: 0, restart: 0, quit: 0 };
  const pm = createPauseMenu({
    onResume: () => {
      fired.resume += 1;
    },
    onRestart: () => {
      fired.restart += 1;
    },
    onQuit: () => {
      fired.quit += 1;
    },
    mount,
  });

  check(mount.children.includes(pm.root), 'pause root mounted');
  check(!pm.isOpen() && pm.root.style.display === 'none', 'pause starts hidden');
  pm.show();
  check(pm.isOpen() && pm.root.style.display === 'flex', 'show() opens the pause overlay');
  check(collectText(pm.root).includes('PAUSED'), 'pause title rendered');

  pm.buttons.resume.fire('click', {});
  pm.buttons.restart.fire('click', {});
  pm.buttons.restart.fire('click', {});
  pm.buttons.quit.fire('click', {});
  check(deepEqual(fired, { resume: 1, restart: 2, quit: 1 }), 'RESUME/RESTART/QUIT clicks fire');

  pm.hide();
  check(!pm.isOpen() && pm.root.style.display === 'none', 'hide() closes the pause overlay');
}

// ===========================================================================
// E. results screen (placeholder)
// ===========================================================================
section('E. results screen');

{
  const mount = makeElement('div');
  const fired = { retry: 0, menu: 0 };
  const rs = createResultsScreen({
    onRetry: () => {
      fired.retry += 1;
    },
    onMenu: () => {
      fired.menu += 1;
    },
    mount,
  });

  check(mount.children.includes(rs.root), 'results root mounted');
  check(!rs.isOpen() && rs.root.style.display === 'none', 'results starts hidden');
  rs.show({
    eventName: 'BLITZ · TOWER RUN',
    timeMs: 81234,
    medal: 'silver',
    bestTimeMs: 81234,
  });
  check(rs.isOpen() && rs.root.style.display === 'flex', 'show(data) opens the overlay');
  check(rs.slots.event.textContent === 'BLITZ · TOWER RUN', 'event name slot filled');
  check(rs.slots.time.textContent === '1:21.234', `time slot filled (got "${rs.slots.time.textContent}")`);
  check(rs.slots.medal.textContent === 'SILVER', 'medal slot filled uppercased');
  check(rs.slots.best.textContent === '1:21.234', 'best slot filled');

  rs.buttons.retry.fire('click', {});
  rs.buttons.menu.fire('click', {});
  check(deepEqual(fired, { retry: 1, menu: 1 }), 'RETRY/MENU clicks fire');

  rs.show({});
  check(rs.slots.time.textContent === '—' && rs.slots.medal.textContent === '—',
    'missing data keeps placeholders');
  rs.show();
  check(rs.slots.event.textContent === '—', 'no-arg show keeps placeholders');
  rs.hide();
  check(!rs.isOpen() && rs.root.style.display === 'none', 'hide() closes the overlay');
}

// ===========================================================================
// F. time formatting edges
// ===========================================================================
section('F. formatRecordTime');

{
  check(formatRecordTime(0) === '0:00.000', 'zero formats');
  check(formatRecordTime(59999) === '0:59.999', 'sub-minute formats');
  check(formatRecordTime(60000) === '1:00.000', 'minute boundary');
  check(formatRecordTime(91234) === '1:31.234', 'sample formats');
  check(formatRecordTime(NaN) === '—', 'NaN renders placeholder');
  check(formatRecordTime(undefined) === '—', 'undefined renders placeholder');
  check(formatRecordTime(-1) === '—', 'negative renders placeholder');
}

const failedTotal = failed;
console.log(
  failedTotal === 0
    ? `  PASS modes-test (${checks} checks)`
    : `  modes-test: ${failedTotal}/${checks} checks FAILED`
);
process.exitCode = failedTotal === 0 ? 0 : 1;
