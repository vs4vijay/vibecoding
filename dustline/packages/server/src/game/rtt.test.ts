import { describe, it, expect } from 'bun:test';
import { HISTORY_TICKS, LAG_COMP_INTERP_MS, TICK_INTERVAL_MS } from '@dustline/shared';
import { clampRttSample, updateRttEwma, applyRttSample } from './rtt.js';
import { PositionHistory, rewindTicksForRtt, resolveShooterRewindTick } from './lagcomp.js';
import { createPlayer, toPlayerState } from './player.js';
import { addPlayer, createGameState, queueInput, tick } from './engine.js';
import { handleOpen, handleClose } from '../websocket/connection.js';

describe('RTT EWMA (pong samples)', () => {
  it('clamps samples into [0, 400] ms', () => {
    expect(clampRttSample(120)).toBe(120);
    expect(clampRttSample(10_000)).toBe(400);
    expect(clampRttSample(-50)).toBe(0);
  });

  it('seeds the EWMA with the first sample, then blends 75% history / 25% new', () => {
    expect(updateRttEwma(0, 100)).toBe(100);
    expect(updateRttEwma(100, 200)).toBe(125); // 100*0.75 + 200*0.25
    expect(updateRttEwma(80, 200)).toBe(110); // 80*0.75 + 200*0.25
  });

  it('applyRttSample feeds recvNow - sentAt through clamp + EWMA', () => {
    const player = createPlayer('Tester', 'T');
    expect(player.rttMs).toBe(0);
    applyRttSample(player, 1000, 1123); // 123 ms round trip
    expect(player.rttMs).toBe(123);
    applyRttSample(player, 2000, 2200); // 200 ms round trip
    expect(player.rttMs).toBeCloseTo(142.25, 5);
  });

  it('clamps a pong "from the future" (negative sample) to 0 ms', () => {
    const player = createPlayer('Tester', 'T');
    applyRttSample(player, 0, 100);
    expect(player.rttMs).toBe(100);
    applyRttSample(player, 5000, 4000); // sample -1000 → clamped to 0 → 100*0.75
    expect(player.rttMs).toBe(75);
  });

  it('ignores non-finite samples so a malformed pong cannot corrupt the estimate', () => {
    const player = createPlayer('Tester', 'T');
    applyRttSample(player, 1000, 1100); // 100
    applyRttSample(player, Number.NaN, 1100);
    applyRttSample(player, 1000, Number.NaN);
    expect(player.rttMs).toBe(100);
  });
});

describe('rewind depth from RTT', () => {
  it('implements ceil((rtt/2 + snapshotAge) / tickInterval) clamped to [0, HISTORY_TICKS]', () => {
    // The margin is one tick: the client renders server snapshots without
    // interpolation, so the newest rendered snapshot is on average half a
    // 30 Hz snapshot interval old (LAG_COMP_INTERP_MS = TICK_INTERVAL_MS).
    expect(LAG_COMP_INTERP_MS).toBe(TICK_INTERVAL_MS);
    // 100 ms RTT: (50 + 16.67) / (1000/60) = exactly 4 ticks
    // (was 6 under the old 50 ms interpolation margin that assumed client-side interp)
    expect(rewindTicksForRtt(100)).toBe(4);
    // Snapshot age alone: ceil(16.67 / 16.67) = 1
    expect(rewindTicksForRtt(0)).toBe(1);
    // Odd RTT rounds up: (8.5 + 16.67) / 16.67 = 1.51 → 2
    expect(rewindTicksForRtt(17)).toBe(2);
    // Absurd RTT is bounded by the history window
    expect(rewindTicksForRtt(1_000_000)).toBe(HISTORY_TICKS);
  });
});

describe('resolveShooterRewindTick', () => {
  it('prefers the rtt-derived depth whenever a measurement exists', () => {
    const history = new PositionHistory();
    const p = createPlayer('P', 'T');
    p.lastInputSeq = 2;
    history.record(1, [p]);

    expect(resolveShooterRewindTick(history, p, 20)).toBe(1); // rtt 0 → seq mapping
    p.rttMs = 100;
    expect(resolveShooterRewindTick(history, p, 20)).toBe(16); // 20 - 4, deeper than the seq tick
  });

  it('falls back to the seq→tick mapping, then currentTick, when no RTT is known', () => {
    const history = new PositionHistory();
    const p = createPlayer('P', 'T');
    p.lastInputSeq = 3;
    history.record(1, [p]);
    p.lastInputSeq = 7;
    history.record(2, [p]);

    expect(resolveShooterRewindTick(history, p, 5)).toBe(2); // p.lastInputSeq 7 → first frame with seq >= 7

    p.lastInputSeq = 9; // acked, but no retained frame reflects it
    expect(resolveShooterRewindTick(history, p, 5)).toBe(5); // → currentTick

    // Legacy fixtures may not carry the field at all — same fallback.
    delete (p as { rttMs?: number }).rttMs;
    expect(resolveShooterRewindTick(history, p, 5)).toBe(5);
  });

  it('bounds the rtt-derived depth by HISTORY_TICKS', () => {
    const history = new PositionHistory();
    const p = createPlayer('P', 'T');
    p.rttMs = 1_000_000;
    expect(resolveShooterRewindTick(history, p, 70)).toBe(10); // 70 - 60
  });
});

describe('rttMs stays server-internal', () => {
  it('createPlayer initializes rttMs to 0', () => {
    expect(createPlayer('Tester', 'T').rttMs).toBe(0);
  });

  it('toPlayerState does not export rttMs into the snapshot', () => {
    const p = createPlayer('Tester', 'T');
    p.rttMs = 123;
    expect('rttMs' in toPlayerState(p)).toBe(false);
  });
});

describe('RTT-aware rewind depth (engine)', () => {
  // Deterministic fire: fireWeapon derives spread from Math.random().
  function withZeroSpread(fn: () => void): void {
    const random = Math.random;
    Math.random = () => 0.5; // (0.5 - 0.5) * 2 * spread === 0
    try {
      fn();
    } finally {
      Math.random = random;
    }
  }

  function makeInput(overrides: Partial<Parameters<typeof queueInput>[2]> = {}): Parameters<typeof queueInput>[2] {
    return {
      forward: false,
      backward: false,
      left: false,
      right: false,
      jump: false,
      walk: false,
      fire: false,
      reload: false,
      weaponSlot: null,
      yaw: 0,
      pitch: 0,
      seq: 0,
      timestamp: 0,
      ...overrides,
    };
  }

  /** Tick 1 records the target ON the ray; ticks 2..5 record it well off it. */
  function setupState() {
    const state = createGameState();
    const shooter = addPlayer(state, 'shooter', 'T');
    const target = addPlayer(state, 'target', 'CT');

    shooter.position = { x: -20, y: 0.9, z: -25 };
    target.position = { x: -15, y: 0.9, z: -25 };
    tick(state); // tick 1: target at the aimed spot

    target.position = { x: -15, y: 0.9, z: -20 }; // strafes off the ray
    for (let i = 0; i < 4; i++) tick(state); // ticks 2..5

    return { state, shooter, target };
  }

  function fireAtOldSpot(state: ReturnType<typeof createGameState>, shooterId: string): void {
    queueInput(state, shooterId, makeInput({
      seq: 1,
      fire: true,
      yaw: Math.PI / 2,
      pitch: -0.334,
    }));
    tick(state); // next tick resolves the bullet
  }

  it('a 100 ms RTT shooter rewinds 4 ticks and hits where the target WAS', () => {
    withZeroSpread(() => {
      const { state, shooter, target } = setupState();
      // depth = ceil((100/2 + 16.67) / (1000/60)) = 4 → rewindTick = 5 - 4 = 1
      // (was 6 ticks before LAG_COMP_INTERP_MS stopped assuming client interpolation)
      shooter.rttMs = 100;
      fireAtOldSpot(state, shooter.id);

      expect(shooter.stats.shotsHit).toBe(1);
      expect(target.health).toBeLessThan(100);
    });
  });

  it('without a measured RTT the same shot follows the seq fallback (currentTick) and misses', () => {
    withZeroSpread(() => {
      const { state, shooter, target } = setupState();
      fireAtOldSpot(state, shooter.id); // fallback → rewindTick 7 → off-ray frame

      expect(shooter.stats.shotsHit).toBe(0);
      expect(target.health).toBe(100);
    });
  });
});

describe('ping loop (connection)', () => {
  it('opens a 1 s ping interval on open, sends {type:"ping", t}, and clears it on close', async () => {
    const opened: { fn: () => void; ms: number }[] = [];
    const timerHandle = { id: 'fake-ping-timer' };
    const cleared: unknown[] = [];
    const realSetInterval = globalThis.setInterval;
    const realClearInterval = globalThis.clearInterval;
    const realLog = console.log;
    (globalThis as unknown as { setInterval: unknown }).setInterval = (fn: () => void, ms: number) => {
      opened.push({ fn, ms });
      return timerHandle;
    };
    (globalThis as unknown as { clearInterval: unknown }).clearInterval = (handle: unknown) => {
      cleared.push(handle);
    };
    console.log = () => {}; // silence connection lifecycle logs
    try {
      const sent: string[] = [];
      const fakeWs = { readyState: 1, send: (data: string) => sent.push(data) } as never;

      handleOpen(fakeWs);
      handleClose(fakeWs);

      expect(opened.length).toBe(1);
      expect(opened[0]!.ms).toBe(1000);
      expect(cleared).toEqual([timerHandle]);

      // Firing the interval body directly (no real 1 s wait) sends a ping
      // carrying the server timestamp.
      opened[0]!.fn();
      expect(sent.length).toBe(1);
      const msg = JSON.parse(sent[0]!);
      expect(msg.type).toBe('ping');
      expect(typeof msg.t).toBe('number');
    } finally {
      globalThis.setInterval = realSetInterval;
      globalThis.clearInterval = realClearInterval;
      console.log = realLog;
    }
  });
});
