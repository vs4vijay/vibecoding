import { describe, expect, it } from 'vitest';
import { FighterSim, type FighterSimWorld } from '../../src/combat/stateMachine';
import { applyHit } from '../../src/combat/hitdetect';
import { MOVES } from '../../src/data/moves';
import { RECOVERY_CHAIN_MIN_MS } from '../../src/data/tuning';
import { ScoreLedger } from '../../src/combat/scoring';
import type { ScoreLedger as LedgerView } from '../../src/combat/scoring';
import type { InputFrame } from '../../src/core/input';

// ---------------------------------------------------------------------------
// Headless sim-scene builders — plain state only; stateMachine must import no
// three/Rapier anywhere in its graph (terrain heightAt is analytic).
import type { HitEvent } from '../../src/combat/stateMachine';
// ---------------------------------------------------------------------------

/** Fixed-step cadence mirrored from the production loop (60Hz). */
const STEP_MS = 1000 / 60;

function makeInput(over: Partial<InputFrame> = {}): InputFrame {
  return {
    moveX: 0,
    moveZ: 0,
    lookDX: 0,
    lookDY: 0,
    pressed: { attack: false, jump: false, crouch: false },
    held: { attack: false, jump: false, crouch: false },
    ...over,
  };
}

interface Pair {
  player: FighterSim;
  dummy: FighterSim;
  world: FighterSimWorld;
}

/**
 * Rabbit player at origin facing +x, wolf dummy 1.2m ahead facing back.
 * 1.2m sits inside punch.rangeM (1.4) and legSweep.rangeM (1.6).
 */
function makePair(dist = 1.2): Pair {
  const player = new FighterSim('rabbit', 'player', true);
  const dummy = new FighterSim('wolf', 'wolf1', false);
  player.state.pos.x = 0;
  player.state.heading = -Math.PI / 2; // facing vector (-sin,-cos) → +x
  dummy.state.pos.x = dist;
  dummy.state.heading = Math.PI / 2; // facing back toward the player
  const world: FighterSimWorld = {
    fighters: [player.state, dummy.state],
    downedBodyNearby: false,
    weaponOnGroundNearby: false,
  };
  return { player, dummy, world };
}

/** Advance `n` fixed steps, feeding the same frame each step. */
function run(sim: FighterSim, n: number, input: InputFrame | null, world: FighterSimWorld): void {
  for (let i = 0; i < n; i++) sim.update(STEP_MS, input, world);
}

/** Step in fixed chunks until predicate holds or budget runs out. */
function runUntil(
  sim: FighterSim,
  input: InputFrame | null,
  world: FighterSimWorld,
  pred: () => boolean,
  maxSteps = 400,
): boolean {
  for (let i = 0; i < maxSteps; i++) {
    if (pred()) return true;
    sim.update(STEP_MS, input, world);
  }
  return pred();
}

/** One attack click: a single frame with the pressed edge set. */
function clickAttack(): InputFrame {
  return makeInput({ pressed: { attack: true, jump: false, crouch: false } });
}

describe('FighterSim move phasing', () => {
  it('press attack standing → punch startup (120ms) → active → recovery → idle', () => {
    const { player, world } = makePair();

    run(player, 1, clickAttack(), world); // edge consumed, startup begins
    expect(player.state.phase.moveId).toBe('punch');

    run(player, 6, makeInput(), world); // 7 steps ≈ 116.7ms < 120ms startup
    expect(player.state.phase.t).toBe('startup');

    run(player, 1, makeInput(), world); // 133.3ms — startup expired
    expect(player.state.phase.t).toBe('active');
    expect(player.state.currentMove).toBe(MOVES.punch);

    run(player, 5, makeInput(), world); // active 80ms fully consumed
    expect(player.state.phase.t).toBe('recovery');

    run(player, 10, makeInput(), world); // 366.7ms — recovery (150ms) expired
    expect(player.state.phase.t).toBe('idle');
    expect(player.state.phase.moveId).toBeUndefined();
    expect(player.state.currentMove).toBeUndefined();
  });

  it('zero-duration utility moves (jump) complete immediately and launch vertically', () => {
    const { player, world } = makePair();
    player.update(
      STEP_MS,
      makeInput({ pressed: { attack: false, jump: true, crouch: false } }),
      world,
    );
    expect(player.state.velY).toBeGreaterThan(0);
    run(player, 2, makeInput(), world);
    expect(player.state.phase.t).toBe('idle'); // jump has no timeline
    expect(player.state.stance).toBe('airborne'); // …the body left the ground
  });
});

describe('FighterSim hit consumption', () => {
  it('stationary dummy in range receives exactly one HitEvent per swing', () => {
    const { player, dummy, world } = makePair();
    const events: HitEvent[] = [];

    run(player, 1, clickAttack(), world);
    for (let i = 0; i < 14; i++) {
      player.update(STEP_MS, makeInput(), world);
      events.push(...player.collectHits([dummy.state]));
    }

    expect(events.length).toBe(1);
    expect(events[0].attackerId).toBe('player');
    expect(events[0].victimId).toBe('wolf1');
    expect(events[0].moveId).toBe('punch');
    // Impact direction points from attacker toward the victim (+x).
    expect(events[0].dirVector.x).toBeCloseTo(1, 5);
    expect(events[0].dirVector.z).toBeCloseTo(0, 5);
  });

  it('collecting twice in the same swing yields nothing the second time', () => {
    const { player, dummy, world } = makePair();
    run(player, 1, clickAttack(), world);
    runUntil(
      player,
      makeInput(),
      world,
      () => player.collectHits([dummy.state]).length > 0,
    );
    expect(player.collectHits([dummy.state])).toEqual([]);
  });

  it('out-of-range dummy is never struck', () => {
    const { player, dummy, world } = makePair(2.5); // beyond punch range 1.4
    run(player, 1, clickAttack(), world);
    let hits = 0;
    for (let i = 0; i < 22; i++) {
      player.update(STEP_MS, makeInput(), world);
      hits += player.collectHits([dummy.state]).length;
    }
    expect(hits).toBe(0);
  });
});

describe('FighterSim input gating', () => {
  it('requesting a move early in recovery is ignored', () => {
    const { player, world } = makePair();
    run(player, 1, clickAttack(), world);
    runUntil(player, makeInput(), world, () => player.state.phase.t === 'recovery');

    const leftAtRecoveryEntry = player.state.phase.phaseMsLeft;
    run(player, 1, clickAttack(), world); // fresh press, recovery far from done

    expect(player.state.phase.t).toBe('recovery');
    // Timer kept draining instead of restarting a move.
    expect(player.state.phase.phaseMsLeft).toBeLessThan(leftAtRecoveryEntry);
    expect(player.state.phase.moveId).toBe('punch');
  });

  it('late-recovery press chains into the next move (chain window)', () => {
    const { player, world } = makePair();
    run(player, 1, clickAttack(), world);
    const chained = runUntil(
      player,
      makeInput(),
      world,
      () =>
        player.state.phase.t === 'recovery' &&
        player.state.phase.phaseMsLeft <= RECOVERY_CHAIN_MIN_MS,
    );
    expect(chained).toBe(true);

    player.update(STEP_MS, clickAttack(), world);
    expect(player.state.phase.t).toBe('startup');
    expect(player.state.phase.moveId).toBe('punch');
  });

  it('a press during active frames is buffered and fires when the move ends', () => {
    const { player, world } = makePair();
    run(player, 1, clickAttack(), world); // punch: startup 120 + active 80
    runUntil(player, makeInput(), world, () => player.state.phase.t === 'active');

    // Deliberate timeline: the press lands ~1 step into active, so the move
    // still has ≈80−16.7+150 ≈ 213ms to run — inside INPUT_BUFFER_MS (250).
    // The buffered follow-up MUST fire when recovery completes.
    player.update(STEP_MS, clickAttack(), world);
    expect(player.state.phase.t).toBe('active'); // press did not interrupt

    const fired = runUntil(
      player,
      makeInput(),
      world,
      () => player.state.phase.t === 'startup',
    );
    expect(fired).toBe(true);
    expect(player.state.phase.moveId).toBe('punch');
  });

  it('a buffered press expires unspent when the move outlasts its window', () => {
    // runningKick timeline: startup 140 + active 90 + recovery 220 = 450ms.
    // A press buffered at active entry waits 310ms > INPUT_BUFFER_MS (250):
    // the buffer must expire unspent and the fighter must land in idle.
    const { player, world } = makePair();
    const runInput = makeInput({ moveZ: -1 });
    const sprinting = runUntil(player, runInput, world, () => player.state.stance === 'running');
    expect(sprinting).toBe(true);
    let kicked = false;
    for (let i = 0; i < 60 && !kicked; i++) {
      player.update(STEP_MS, { ...runInput, pressed: { attack: true, jump: false, crouch: false } }, world);
      kicked = player.state.phase.moveId === 'runningKick';
    }
    expect(kicked).toBe(true);

    // Ride to active entry with input released, then buffer ONE kick press.
    const activeEntry = runUntil(player, makeInput(), world, () => player.state.phase.t === 'active');
    expect(activeEntry).toBe(true);
    player.update(STEP_MS, { ...runInput, pressed: { attack: true, jump: false, crouch: false } }, world);
    const fired = runUntil(
      player,
      makeInput(),
      world,
      () => player.state.phase.t === 'startup',
      60,
    );
    expect(fired).toBe(false); // 310ms wait > 250ms window
  });

  it('presses during hitstun are dropped entirely', () => {
    const { player, dummy, world } = makePair();
    // Dummy punches the player into hitstun.
    run(dummy, 1, clickAttack(), { ...world, fighters: [dummy.state, player.state] });
    runUntil(
      dummy,
      makeInput(),
      { ...world, fighters: [dummy.state, player.state] },
      () => dummy.collectHits([player.state]).length > 0,
    );
    applyHit(
      {
        attackerId: 'wolf1',
        victimId: 'player',
        moveId: 'punch',
        dirVector: { x: -1, z: 0 },
      },
      [player.state, dummy.state],
    );
    expect(player.state.phase.t).toBe('hitstun');

    run(player, 1, clickAttack(), world);
    expect(player.state.phase.t).toBe('hitstun'); // ignored, not buffered
  });
});

describe('FighterSim antiRep contract (T8 live)', () => {
  it('initializes antiRep and records every fired punch (T8 takeover complete)', () => {
    const { player, world } = makePair();
    for (let i = 0; i < 3; i++) {
      run(player, 1, clickAttack(), world);
      runUntil(player, makeInput(), world, () => player.state.phase.t === 'idle');
    }
    // T8's antirepetition.ts now owns tracking: the sim initializes the
    // state and records each fired attack through recordAttack.
    expect(player.state.antiRep).toBeDefined();
    expect(player.state.antiRep!.lastMoveIds).toEqual(['punch', 'punch', 'punch']);
  });
});

describe('FighterSim knockdown and stagger outcomes', () => {
  function sweepAt(crouchedVictim: boolean): Pair {
    const pair = makePair();
    // Attacker settles into crouch, then sweeps.
    const crouchInput = makeInput({ held: { attack: false, jump: false, crouch: true } });
    run(pair.player, 3, crouchInput, pair.world);
    expect(pair.player.state.stance).toBe('crouched');
    pair.player.update(STEP_MS, {
      ...crouchInput,
      pressed: { attack: true, jump: false, crouch: true },
    }, pair.world);
    expect(pair.player.state.phase.moveId).toBe('legSweep');

    // Victim stance: standing dummy, or a dummy holding crouch.
    if (crouchedVictim) {
      run(pair.dummy, 3, makeInput({ held: { attack: false, jump: false, crouch: true } }), pair.world);
      expect(pair.dummy.state.stance).toBe('crouched');
    }
    return pair;
  }

  function landSweep(pair: Pair): void {
    const { player, dummy, world } = pair;
    let events: HitEvent[] = [];
    for (let i = 0; i < 200 && events.length === 0; i++) {
      player.update(STEP_MS, makeInput(), world);
      events = player.collectHits([dummy.state]);
    }
    expect(events.length).toBe(1);
    applyHit(events[0], [player.state, dummy.state]);
  }

  it('legSweep downs a standing victim (downed phase + velY impulse)', () => {
    const pair = sweepAt(false);
    landSweep(pair);
    expect(pair.dummy.state.phase.t).toBe('downed');
    expect(pair.dummy.state.velY).toBeCloseTo(3.5, 5);
    expect(pair.dummy.state.hp).toBe(160 - 10); // wolf 160hp, rabbit mult 1.0
  });

  it('legSweep merely staggers a crouched victim (hitstun, no knockdown)', () => {
    const pair = sweepAt(true);
    landSweep(pair);
    expect(pair.dummy.state.phase.t).toBe('hitstun');
    expect(pair.dummy.state.phase.phaseMsLeft).toBeCloseTo(350, 5);
    expect(pair.dummy.state.velY).toBe(0);
  });

  it('a downed victim gets back up after the ground timer', () => {
    const pair = sweepAt(false);
    landSweep(pair);
    const got = runUntil(
      pair.dummy,
      null,
      pair.world,
      () => pair.dummy.state.phase.t === 'idle',
      120,
    );
    expect(got).toBe(true);
    expect(pair.dummy.state.phase.t).toBe('idle');
  });

  it('hitstun expires back to idle after 350ms', () => {
    const { player, dummy, world } = makePair();
    // Punch the dummy into stagger.
    run(player, 1, clickAttack(), world);
    runUntil(player, makeInput(), world, () => player.collectHits([dummy.state]).length > 0);
    applyHit(
      {
        attackerId: 'player',
        victimId: 'wolf1',
        moveId: 'punch',
        dirVector: { x: 1, z: 0 },
      },
      [player.state, dummy.state],
    );
    expect(dummy.state.phase.t).toBe('hitstun');
    const got = runUntil(dummy, null, world, () => dummy.state.phase.t === 'idle');
    expect(got).toBe(true);
  });
});

describe('FighterSim KO and null-input dummy', () => {
  it('lethal hit flips the victim to ko with the unconscious flag', () => {
    const { player, dummy, world } = makePair();
    dummy.state.hp = 5;
    run(player, 1, clickAttack(), world);
    runUntil(player, makeInput(), world, () => player.collectHits([dummy.state]).length > 0);
    applyHit(
      {
        attackerId: 'player',
        victimId: 'wolf1',
        moveId: 'punch',
        dirVector: { x: 1, z: 0 },
      },
      [player.state, dummy.state],
    );
    expect(dummy.state.phase.t).toBe('ko');
    expect(dummy.state.flags.unconscious).toBe(true);
    expect(dummy.state.hp).toBe(0);
    run(dummy, 10, null, world); // corpse keeps simulating harmlessly
    expect(dummy.state.phase.t).toBe('ko');
  });

  it('null-input dummy integrates physics and rests on the terrain', () => {
    const dummy = new FighterSim('wolf', 'wolf1', false);
    dummy.state.pos.y = 5; // dropped from the sky
    const world: FighterSimWorld = {
      fighters: [dummy.state],
      downedBodyNearby: false,
      weaponOnGroundNearby: false,
    };
    run(dummy, 120, null, world); // ~2s of falling + settling
    const gy = 1.2 * Math.sin(dummy.state.pos.x * 0.08) * Math.cos(dummy.state.pos.z * 0.06)
      + 0.6 * Math.sin((dummy.state.pos.x + dummy.state.pos.z) * 0.045)
      + 0.25 * Math.sin(dummy.state.pos.x * 0.21 + dummy.state.pos.z * 0.17);
    expect(dummy.state.pos.y).toBeCloseTo(gy, 5);
    expect(dummy.state.phase.t).toBe('idle');
    expect(Number.isNaN(dummy.state.pos.x)).toBe(false);
  });
});

describe('FighterSim lunge', () => {
  it('lunging move advances at lungeSpeed along facing during active frames', () => {
    const { player, world } = makePair(3.0); // start beyond kick reach
    // Sprint toward the dummy (heading faces +x; moveZ -1 = forward).
    const runInput = makeInput({ moveZ: -1 });
    const sprinting = runUntil(player, runInput, world, () => player.state.stance === 'running');
    expect(sprinting).toBe(true);

    const kickPress = { ...runInput, pressed: { attack: true, jump: false, crouch: false } };
    let kicked = false;
    for (let i = 0; i < 60 && !kicked; i++) {
      player.update(STEP_MS, kickPress, world);
      kicked = player.state.phase.moveId === 'runningKick';
    }
    expect(kicked).toBe(true); // resolver offers runningKick once isRunning

    // Ride out startup (140ms) until active begins, input released so the
    // measured displacement is the move's lunge alone.
    const idleInput = makeInput();
    const active = runUntil(player, idleInput, world, () => player.state.phase.t === 'active');
    expect(active).toBe(true);

    // Lunge covers exactly lungeSpeed × dt along heading per active step.
    const xBefore = player.state.pos.x;
    player.update(STEP_MS, idleInput, world);
    expect(player.state.phase.t).toBe('active');
    expect(player.state.pos.x - xBefore).toBeCloseTo(
      MOVES.runningKick.lungeSpeed! * (STEP_MS / 1000),
      3,
    );
  });
});

// ---------------------------------------------------------------------------
// Task 9 wiring — injury tick runs inside update(); ledger is injected.
// ---------------------------------------------------------------------------

describe('FighterSim injury wiring (T9)', () => {
  it('update() ticks injuries: bleeding drains hp across sim steps', () => {
    const { player, world } = makePair();
    player.state.flags.bleeding = true;
    const hp0 = player.state.hp;
    run(player, 120, makeInput(), world); // 2s of bleed
    expect(hp0 - player.state.hp).toBeCloseTo(2000 * 0.002, 4);
    // Renderer-facing poll: whatever the LAST step emitted (a bleeding
    // fighter emits 'bled' on every draining step — here [{type:'bled'}]).
    expect(player.lastInjuryEvents).toEqual([{ type: 'bled' }]);
  });

  it('lastInjuryEvents exposes the transition of the most recent step', () => {
    const { player, world } = makePair();
    player.state.hp = 30; // below the limp threshold
    run(player, 1, makeInput(), world);
    expect(player.lastInjuryEvents).toEqual([{ type: 'limped' }]);
    run(player, 1, makeInput(), world); // settled — no repeat emission
    expect(player.lastInjuryEvents).toEqual([]);
  });

  it('bleed alone never KOs through the sim: clamps at the 1hp floor', () => {
    const { player, world } = makePair();
    player.state.hp = 2;
    player.state.flags.bleeding = true;
    run(player, 240, makeInput(), world); // 4s — would drain 8hp unclamped
    expect(player.state.hp).toBe(1);
    expect(player.state.phase.t).not.toBe('ko');
  });

  it('a KO from applyHit stays terminal under the injury tick', () => {
    const { dummy, world } = makePair();
    dummy.state.hp = 1;
    const hit: HitEvent = {
      attackerId: 'player',
      victimId: 'wolf1',
      moveId: 'punch',
      dirVector: { x: 1, z: 0 },
    };
    applyHit(hit, world.fighters);
    expect(dummy.state.phase.t).toBe('ko');
    run(dummy, 10, null, world);
    expect(dummy.state.phase.t).toBe('ko');
  });
});

describe('FighterSim reversal score hook (T9)', () => {
  it('a successful reversal awards REVERSAL into the injected ledger', () => {
    const ledger: LedgerView = new ScoreLedger();
    const { player, dummy, world } = makePair();
    player.setScoreLedger(ledger);

    const wolfClick = makeInput({ pressed: { attack: true, jump: false, crouch: false } });
    run(dummy, 1, wolfClick, world); // wolf begins its punch
    expect(dummy.state.phase.moveId).toBe('punch');
    const pressed = runUntil(dummy, makeInput(), world, () =>
      dummy.state.moveElapsedMs >= 48,
    );
    expect(pressed).toBe(true);

    // Crouch press inside the window (same recipe as reversal.test.ts).
    const crouch = makeInput({ pressed: { attack: false, jump: false, crouch: true } });
    player.update(STEP_MS, crouch, world);
    expect(player.state.pendingReverseOf).toBe('wolf1'); // reversal fired
    expect(ledger.total()).toBe(30);
  });
});
