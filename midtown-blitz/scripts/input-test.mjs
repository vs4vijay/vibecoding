#!/usr/bin/env node
/**
 * Scripted verification harness for src/engine/input.js (task 1.3).
 *
 * Stands in for the "?debug overlay" manual check by driving the manager's
 * exposed DOM handlers (`handleKeyDown`/`handleKeyUp`) with fake key events,
 * and by attaching it to a minimal fake event target to prove the real
 * addEventListener/dispose wiring. Assertions, per the task:
 *
 *   1. key mapping contract  -> WASD/arrows, Space, R, C, Esc map to the
 *      eight game actions; every mapped key holds and releases its action
 *   2. edge events           -> a press fires exactly one press edge even
 *      with e.repeat auto-repeat flooding; keyup fires exactly one release
 *   3. stray duplicates      -> duplicate keydown/keyup cannot double-fire
 *      edges (exactly-once guarantee holds)
 *   4. two keys, one action  -> W and ArrowUp both drive `throttle`; the
 *      action stays held until every binding is released
 *   5. window blur           -> dispatching blur through the attached target
 *      clears every held action silently (no edges), and keys work after
 *   6. preventDefault        -> game keys are prevented on keydown (repeats
 *      too), unmapped keys are never touched, editable targets (<input>,
 *      contentEditable) are guarded, keyups never prevent and always release
 *   7. dispose               -> removes the keydown/keyup/blur listeners so
 *      later events are ignored; safe to call twice
 *   8. onEdge subscription   -> multiple listeners fire; unsubscribe stops
 *      exactly one; events carry {type, action, code}
 *
 * Run: node scripts/input-test.mjs   (plain node, no dependencies)
 */
import {
  createInputManager,
  ACTIONS,
  ACTION_CODES,
  KEYMAP,
} from '../src/engine/input.js';

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
 * Build a fake KeyboardEvent look-alike with a preventDefault spy.
 * @param {string} code Physical key (KeyboardEvent.code).
 * @param {{repeat?: boolean, target?: unknown}} [opts] Event options.
 * @returns {{code: string, repeat: boolean, target: unknown, defaultPrevented: boolean, preventDefault: () => void}} Fake event.
 */
function keyEvent(code, { repeat = false, target = null } = {}) {
  return {
    code,
    repeat,
    target,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
}

/**
 * Minimal EventTarget stand-in recording its listeners, so the attach and
 * dispose wiring can be verified in plain node.
 * @returns {{addEventListener: Function, removeEventListener: Function, dispatch: Function, count: (type: string) => number}} Fake target.
 */
function makeFakeTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      const set = listeners.get(type);
      if (set) set.delete(fn);
    },
    dispatch(type, event) {
      const set = listeners.get(type);
      if (!set) return;
      for (const fn of [...set]) fn(event);
    },
    count(type) {
      return listeners.get(type) ? listeners.get(type).size : 0;
    },
  };
}

/**
 * Count collected edge events matching a predicate.
 * @param {object[]} events Collected edge events.
 * @param {(e: object) => boolean} pred Predicate.
 * @returns {number} Match count.
 */
const countWhere = (events, pred) => events.filter(pred).length;

console.log('input-test: scripted keyboard input verification\n');

// --- 1. Mapping contract + polled state per mapped key ----------------------
{
  const name = 'mapping contract + polled state';
  console.log(`  ${name}`);

  check(KEYMAP.KeyW === 'throttle' && KEYMAP.ArrowUp === 'throttle', `${name}: W and ArrowUp -> throttle`);
  check(KEYMAP.KeyS === 'brake' && KEYMAP.ArrowDown === 'brake', `${name}: S and ArrowDown -> brake (brake/reverse)`);
  check(KEYMAP.KeyA === 'left' && KEYMAP.ArrowLeft === 'left', `${name}: A and ArrowLeft -> left`);
  check(KEYMAP.KeyD === 'right' && KEYMAP.ArrowRight === 'right', `${name}: D and ArrowRight -> right`);
  check(KEYMAP.Space === 'handbrake', `${name}: Space -> handbrake`);
  check(KEYMAP.KeyR === 'reset', `${name}: R -> reset`);
  check(KEYMAP.KeyC === 'camera', `${name}: C -> camera`);
  check(KEYMAP.Escape === 'pause', `${name}: Esc -> pause`);
  check(ACTIONS.length === 8, `${name}: exactly the 8 game actions are exported`);

  const input = createInputManager({ attach: false });
  const snap = input.snapshot();
  check(
    ACTIONS.every((a) => snap[a] === false) && Object.keys(snap).length === ACTIONS.length,
    `${name}: fresh manager snapshot has all 8 actions false`
  );

  let allOk = true;
  for (const action of ACTIONS) {
    for (const code of ACTION_CODES[action]) {
      input.handleKeyDown(keyEvent(code));
      const heldOk = input.isDown(action);
      input.handleKeyUp(keyEvent(code));
      const releasedOk = !input.isDown(action);
      if (!heldOk || !releasedOk) allOk = false;
    }
  }
  check(allOk, `${name}: every mapped key holds its action on keydown and clears it on keyup`);
  check(input.isDown('nonexistent') === false, `${name}: isDown with an unknown action is false (no crash)`);
}

// --- 2. Edges fire exactly once per press despite OS auto-repeat ------------
{
  const name = 'edges exactly once with e.repeat flooding';
  console.log(`  ${name}`);
  const input = createInputManager({ attach: false });
  const events = [];
  input.onEdge((e) => events.push(e));

  input.handleKeyDown(keyEvent('Space')); // the one physical press
  for (let i = 0; i < 5; i += 1) {
    input.handleKeyDown(keyEvent('Space', { repeat: true })); // OS auto-repeat storm
  }
  check(input.isDown('handbrake'), `${name}: handbrake stays held through the repeats`);
  check(
    countWhere(events, (e) => e.type === 'press' && e.action === 'handbrake' && e.code === 'Space') === 1,
    `${name}: exactly ONE press edge after 1 press + 5 auto-repeats (got ${countWhere(events, (e) => e.type === 'press')})`
  );
  check(events.length === 1, `${name}: no release or stray edges so far`);

  input.handleKeyUp(keyEvent('Space'));
  check(
    events.length === 2 && events[1].type === 'release' && events[1].action === 'handbrake' && events[1].code === 'Space',
    `${name}: keyup fires exactly one release edge carrying {type, action, code}`
  );
  check(!input.isDown('handbrake'), `${name}: handbrake polled state cleared after release`);

  input.handleKeyUp(keyEvent('Space'));
  check(events.length === 2, `${name}: a second keyup without a press fires nothing (edges stay balanced)`);
}

// --- 3. Stray duplicate keydown/keyup cannot double-fire --------------------
{
  const name = 'stray duplicates (exactly-once guard)';
  console.log(`  ${name}`);
  const input = createInputManager({ attach: false });
  const events = [];
  input.onEdge((e) => events.push(e));

  input.handleKeyDown(keyEvent('KeyR'));
  input.handleKeyDown(keyEvent('KeyR')); // non-repeat duplicate (defensive; browsers should not send this)
  input.handleKeyDown(keyEvent('KeyR', { repeat: true }));
  check(
    countWhere(events, (e) => e.type === 'press') === 1,
    `${name}: duplicate keydowns produce exactly one press edge`
  );
  input.handleKeyUp(keyEvent('KeyR'));
  input.handleKeyUp(keyEvent('KeyR'));
  check(
    countWhere(events, (e) => e.type === 'release') === 1,
    `${name}: duplicate keyups produce exactly one release edge`
  );
}

// --- 4. Two keys driving the same action ------------------------------------
{
  const name = 'two keys -> one action';
  console.log(`  ${name}`);
  const input = createInputManager({ attach: false });
  const events = [];
  input.onEdge((e) => events.push(e));

  input.handleKeyDown(keyEvent('KeyA'));
  check(input.isDown('left'), `${name}: A holds left`);
  input.handleKeyDown(keyEvent('ArrowLeft'));
  check(input.isDown('left'), `${name}: ArrowUp-style second binding keeps left held`);
  input.handleKeyUp(keyEvent('KeyA'));
  check(input.isDown('left'), `${name}: left STAYS held while the second binding is still down`);
  input.handleKeyUp(keyEvent('ArrowLeft'));
  check(!input.isDown('left'), `${name}: left clears only once every binding is released`);
  check(
    countWhere(events, (e) => e.type === 'press' && e.action === 'left') === 2,
    `${name}: both physical keys fired their own press edge (${countWhere(events, (e) => e.type === 'press')} presses)`
  );
}

// --- 5. Window blur clears all (and proves the attach wiring) ---------------
{
  const name = 'window blur clears held keys';
  console.log(`  ${name}`);
  const target = makeFakeTarget();
  const input = createInputManager({ target, attach: true });
  check(
    target.count('keydown') === 1 && target.count('keyup') === 1 && target.count('blur') === 1,
    `${name}: attaches exactly one keydown, keyup, and blur listener`
  );

  const events = [];
  input.onEdge((e) => events.push(e));
  target.dispatch('keydown', keyEvent('KeyW'));
  target.dispatch('keydown', keyEvent('Space'));
  target.dispatch('keydown', keyEvent('ArrowUp'));
  check(input.isDown('throttle') && input.isDown('handbrake'), `${name}: keys dispatched via the real listener path hold their actions`);

  const edgesBeforeBlur = events.length;
  check(edgesBeforeBlur === 3, `${name}: the three presses above fired 3 press edges (got ${edgesBeforeBlur})`);
  target.dispatch('blur', {});
  const snap = input.snapshot();
  check(ACTIONS.every((a) => snap[a] === false), `${name}: blur clears every held action`);
  check(events.length === edgesBeforeBlur, `${name}: blur itself fires no edge events (silent clear, documented)`);

  target.dispatch('keydown', keyEvent('ArrowUp'));
  check(input.isDown('throttle'), `${name}: keys hold again normally after a blur`);
}

// --- 6. preventDefault on game keys only + typing guard ---------------------
{
  const name = 'preventDefault scoping';
  console.log(`  ${name}`);
  const input = createInputManager({ attach: false });

  const game = keyEvent('KeyW');
  input.handleKeyDown(game);
  check(game.defaultPrevented, `${name}: game key keydown is preventDefault-ed (Space cannot scroll the page)`);
  const rep = keyEvent('KeyW', { repeat: true });
  input.handleKeyDown(rep);
  check(rep.defaultPrevented, `${name}: auto-repeat keydown of a game key is prevented too`);
  const up = keyEvent('KeyW');
  input.handleKeyUp(up);
  check(!up.defaultPrevented, `${name}: keyup never calls preventDefault (documented; nothing to prevent)`);

  let unmappedOk = true;
  for (const code of ['KeyQ', 'F5', 'ShiftLeft', 'Tab', 'KeyZ', 'Numpad1']) {
    const ev = keyEvent(code);
    input.handleKeyDown(ev);
    if (ev.defaultPrevented) unmappedOk = false;
    if (ACTIONS.some((a) => input.isDown(a))) unmappedOk = false;
    input.handleKeyUp(ev);
  }
  check(unmappedOk, `${name}: unmapped keys (Q, F5, Shift, Tab, Z, Numpad1) are never prevented and never change state`);

  const inInput = keyEvent('Space', { target: { tagName: 'INPUT' } });
  input.handleKeyDown(inInput);
  check(!inInput.defaultPrevented, `${name}: game key NOT prevented while typing in an <input> (settings sliders keep arrows)`);
  check(!input.isDown('handbrake'), `${name}: game key does not change polled state while typing in an <input>`);

  const inSelect = keyEvent('ArrowDown', { target: { tagName: 'SELECT' } });
  input.handleKeyDown(inSelect);
  check(!inSelect.defaultPrevented && !input.isDown('brake'), `${name}: <select> targets are guarded too`);

  const editable = keyEvent('ArrowUp', { target: { tagName: 'DIV', isContentEditable: true } });
  input.handleKeyDown(editable);
  check(!editable.defaultPrevented && !input.isDown('throttle'), `${name}: contentEditable targets are guarded too`);

  input.handleKeyDown(keyEvent('KeyW'));
  const upInInput = keyEvent('KeyW', { target: { tagName: 'INPUT' } });
  input.handleKeyUp(upInInput);
  check(!input.isDown('throttle'), `${name}: keyup inside an <input> still releases the held key (no stuck keys after focus change)`);
  check(!upInInput.defaultPrevented, `${name}: that keyup still prevents nothing`);
}

// --- 7. dispose removes listeners -------------------------------------------
{
  const name = 'dispose';
  console.log(`  ${name}`);
  const target = makeFakeTarget();
  const input = createInputManager({ target, attach: true });
  const events = [];
  input.onEdge((e) => events.push(e));

  input.dispose();
  check(
    target.count('keydown') === 0 && target.count('keyup') === 0 && target.count('blur') === 0,
    `${name}: dispose removes the keydown, keyup, and blur listeners`
  );
  target.dispatch('keydown', keyEvent('KeyW'));
  target.dispatch('keyup', keyEvent('KeyW'));
  target.dispatch('blur', {});
  check(!input.isDown('throttle') && events.length === 0, `${name}: events dispatched after dispose are ignored`);
  input.handleKeyDown(keyEvent('Space'));
  check(!input.isDown('handbrake') && events.length === 0, `${name}: the handler seam is dead after dispose too`);
  input.dispose();
  check(
    target.count('keydown') === 0 && target.count('keyup') === 0 && target.count('blur') === 0,
    `${name}: a second dispose is a safe no-op`
  );
}

// --- 8. onEdge subscribe/unsubscribe ----------------------------------------
{
  const name = 'onEdge subscription';
  console.log(`  ${name}`);
  const input = createInputManager({ attach: false });
  const seenA = [];
  const seenB = [];
  const offA = input.onEdge((e) => seenA.push(e));
  input.onEdge((e) => seenB.push(e));

  input.handleKeyDown(keyEvent('KeyC'));
  check(seenA.length === 1 && seenB.length === 1, `${name}: multiple subscribed listeners all fire`);

  offA();
  input.handleKeyUp(keyEvent('KeyC'));
  check(seenA.length === 1 && seenB.length === 2, `${name}: unsubscribe stops exactly that one listener`);
  check(
    seenB[1].type === 'release' && seenB[1].action === 'camera' && seenB[1].code === 'KeyC',
    `${name}: edge events carry {type, action, code}`
  );

  let threw = false;
  try {
    input.onEdge(null);
  } catch {
    threw = true;
  }
  check(threw, `${name}: onEdge rejects a non-function listener`);
}

console.log(`\ninput-test: ${checks - failed}/${checks} assertions passed`);
if (failed > 0) {
  console.log(`input-test: ${failed} FAILED`);
  process.exit(1);
}
console.log('input-test: ALL PASS');
