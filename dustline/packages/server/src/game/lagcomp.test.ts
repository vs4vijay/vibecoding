import { describe, it, expect } from 'bun:test';
import { HISTORY_TICKS, PLAYER_HEIGHT, PLAYER_RADIUS } from '@dustline/shared';
import type { ServerBullet, ServerPlayer } from './types.js';
import { PositionHistory, rewoundHitboxToAABB, resolveRewindTick } from './lagcomp.js';
import { findBulletHit } from './weapon.js';
import { addPlayer, createGameState, queueInput, tick } from './engine.js';

function makePlayer(id: string, x: number, y: number, z: number, lastInputSeq = 0): ServerPlayer {
  return {
    id,
    username: id,
    team: 'T',
    position: { x, y, z },
    rotation: { x: 0, y: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    health: 100,
    armor: 100,
    isDead: false,
    isWalking: false,
    isGrounded: true,
    primaryWeapon: null,
    secondaryWeapon: null,
    currentWeaponSlot: 'primary',
    inputSeq: 0,
    lastInputSeq,
    stats: {
      kills: 0,
      deaths: 0,
      assists: 0,
      headshots: 0,
      shotsFired: 0,
      shotsHit: 0,
      damageDealt: 0,
    },
    respawnTimer: 0,
    lastInputTime: 0,
    onGround: true,
  };
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

function makeBullet(shooterId: string, origin: { x: number; y: number; z: number }): ServerBullet {
  return {
    id: 'bullet-1',
    shooterId,
    origin,
    direction: { x: 1, y: 0, z: 0 },
    damage: 36,
    createdAt: 0,
    weaponId: 'ak47',
    hitPlayerId: null,
    expired: false,
    rewindTick: 1,
  };
}

describe('PositionHistory', () => {
  it('records hitboxes per tick and rewinds to an older tick', () => {
    const history = new PositionHistory();
    const p = makePlayer('p1', 1, 2, 3);

    history.record(1, [p]);
    p.position = { x: 10, y: 2, z: 3 };
    history.record(2, [p]);

    const old = history.rewind('p1', 1);
    expect(old).not.toBeNull();
    expect(old!.pos).toEqual({ x: 1, y: 2, z: 3 });
    expect(old!.eyeHeight).toBe(PLAYER_HEIGHT / 2);
    expect(old!.radius).toBe(PLAYER_RADIUS);

    const current = history.rewind('p1', 2);
    expect(current!.pos).toEqual({ x: 10, y: 2, z: 3 });
  });

  it('evicts frames beyond HISTORY_TICKS and stays bounded', () => {
    const history = new PositionHistory();
    const p = makePlayer('p1', 0, 0, 0);

    for (let t = 1; t <= HISTORY_TICKS + 10; t++) {
      history.record(t, [p]);
      p.position = { x: t, y: 0, z: 0 };
    }

    expect(history.size).toBe(HISTORY_TICKS);
    expect(history.rewind('p1', 10)).toBeNull(); // long evicted
    expect(history.rewind('p1', 11)).not.toBeNull(); // oldest surviving frame
    expect(history.rewind('p1', HISTORY_TICKS + 10)).not.toBeNull(); // newest frame
  });

  it('returns null for an unknown player or a tick with no frame', () => {
    const history = new PositionHistory();
    const p = makePlayer('p1', 0, 0, 0);
    history.record(1, [p]);

    expect(history.rewind('ghost', 1)).toBeNull();
    expect(history.rewind('p1', 42)).toBeNull();
  });

  it('maps an acked input seq to the first tick that reflects it', () => {
    const history = new PositionHistory();
    const p = makePlayer('p1', 0, 0, 0, 0);

    history.record(1, [p]);
    p.lastInputSeq = 3;
    history.record(2, [p]);

    expect(history.findTickForInputSeq('p1', 1)).toBe(2);
    expect(history.findTickForInputSeq('p1', 3)).toBe(2);
    expect(history.findTickForInputSeq('p1', 4)).toBeNull();
    expect(history.findTickForInputSeq('ghost', 1)).toBeNull();
  });
});

describe('resolveRewindTick', () => {
  it('returns the recorded tick clamped to the history window', () => {
    const history = new PositionHistory();
    const p = makePlayer('p1', 0, 0, 0, 2);
    for (let t = 1; t <= 5; t++) {
      history.record(t, [p]);
    }

    // Acked seq 2 is first reflected at tick 1; at currentTick 500 the window
    // is [440, 500], so the resolved tick is clamped to 440.
    expect(resolveRewindTick(history, 'p1', 2, 500)).toBe(440);
    expect(resolveRewindTick(history, 'p1', 2, 3)).toBe(1);
  });

  it('falls back to the current tick when the seq is unknown', () => {
    const history = new PositionHistory();
    const p = makePlayer('p1', 0, 0, 0, 0);
    history.record(1, [p]);

    expect(resolveRewindTick(history, 'p1', 9, 1)).toBe(1);
  });
});

describe('rewoundHitboxToAABB', () => {
  it('builds the full body box from pos, eyeHeight and radius', () => {
    const aabb = rewoundHitboxToAABB({
      pos: { x: 5, y: 0.9, z: -3 },
      eyeHeight: PLAYER_HEIGHT / 2,
      radius: PLAYER_RADIUS,
    });

    expect(aabb.min).toEqual({ x: 5 - PLAYER_RADIUS, y: 0.9 - PLAYER_HEIGHT / 2, z: -3 - PLAYER_RADIUS });
    expect(aabb.max).toEqual({ x: 5 + PLAYER_RADIUS, y: 0.9 + PLAYER_HEIGHT / 2, z: -3 + PLAYER_RADIUS });
  });
});

describe('findBulletHit', () => {
  it('tests live positions on the default path and rewound hitboxes when given', () => {
    const shooter = makePlayer('s', 0, 0.9, 0);
    const target = makePlayer('t', 10, 0.9, 0);
    const bullet = makeBullet('s', { x: 1, y: 0.9, z: 0 });

    const liveHit = findBulletHit(bullet, [shooter, target]);
    expect(liveHit).not.toBeNull();
    expect(liveHit!.player.id).toBe('t');
    expect(liveHit!.headshot).toBe(false);
    expect(liveHit!.t).toBeCloseTo(8.7, 5);

    // Rewound target stands closer to the shooter, so the ray connects earlier.
    const rewound = new Map([
      ['t', {
        position: { x: 5, y: 0.9, z: 0 },
        aabb: rewoundHitboxToAABB({ pos: { x: 5, y: 0.9, z: 0 }, eyeHeight: PLAYER_HEIGHT / 2, radius: PLAYER_RADIUS }),
      }],
    ]);
    const rewoundHit = findBulletHit(bullet, [shooter, target], rewound);
    expect(rewoundHit).not.toBeNull();
    expect(rewoundHit!.t).toBeCloseTo(3.7, 5);
  });

  it('skips the shooter and dead players', () => {
    const shooter = makePlayer('s', 0, 0.9, 0);
    const dead = makePlayer('d', 10, 0.9, 0);
    dead.isDead = true;
    const bullet = makeBullet('s', { x: 1, y: 0.9, z: 0 });

    expect(findBulletHit(bullet, [shooter, dead])).toBeNull();
  });
});

describe('lag compensation (engine)', () => {
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

  it('registers a hit when the shooter fires at where the target WAS', () => {
    withZeroSpread(() => {
      const state = createGameState();
      const shooter = addPlayer(state, 'shooter', 'T');
      const target = addPlayer(state, 'target', 'CT');

      shooter.position = { x: -20, y: 0.9, z: -25 };
      target.position = { x: -15, y: 0.9, z: -25 };

      // Tick 1 records the target at (-15, 0.9, -25) — what the shooter saw.
      tick(state);

      // The target then strafes well off the ray before the shot arrives.
      target.position = { x: -15, y: 0.9, z: -20 };

      // The shooter fires along +x at the spot the target used to occupy.
      queueInput(state, shooter.id, makeInput({
        seq: 1,
        fire: true,
        yaw: Math.PI / 2,
        pitch: -0.334,
      }));
      tick(state); // tick 2 resolves the bullet against the rewound target

      expect(shooter.stats.shotsHit).toBe(1);
      expect(target.health).toBeLessThan(100);
    });
  });

  it('does not hit a target that was never at the aimed spot', () => {
    withZeroSpread(() => {
      const state = createGameState();
      const shooter = addPlayer(state, 'shooter', 'T');
      const target = addPlayer(state, 'target', 'CT');

      shooter.position = { x: -20, y: 0.9, z: -25 };
      target.position = { x: -15, y: 0.9, z: -20 }; // off the ray from the start

      tick(state);
      queueInput(state, shooter.id, makeInput({
        seq: 1,
        fire: true,
        yaw: Math.PI / 2,
        pitch: -0.334,
      }));
      tick(state);

      expect(shooter.stats.shotsHit).toBe(0);
      expect(target.health).toBe(100);
    });
  });
});
