/**
 * Task 17 — boulder wall layout + nearest-wall probe.
 *
 * Includes the Task 14 review P1 hard carry: the world.wall probe MUST be
 * populated from THIS layout and wallKick must resolve through the real
 * resolver path with it (previously the field had no producer, making
 * wallKick/STYLE_WALLKICK unreachable in production).
 */
import { describe, expect, it } from 'vitest';
import { BOULDER_CLUSTERS, BOULDER_WALLS, nearestWall, type WallProbe } from '../../src/world/walls';
import { WALL_KICK_MIN_HEIGHT_M } from '../../src/data/tuning';
import { MOVES } from '../../src/data/moves';
import { FighterSim } from '../../src/combat/stateMachine';
import type { FighterSimWorld, HitEvent } from '../../src/combat/stateMachine';
import { WALL_KICK_LAUNCH_MPS } from '../../src/data/tuning';

/** Fixed-step cadence mirrored from the production loop (60Hz). */
const STEP_MS = 1000 / 60;

/** Player + dummy spawns (game.ts scatters bushes/boulders clear of these). */
const SPAWNS = [
  { x: 0, z: 0 },
  { x: 0, z: -3 },
];

function probe(x: number, z: number): WallProbe {
  const out: WallProbe = { proximityM: -1, awayX: 0, awayZ: 0 };
  const found = nearestWall({ x, z }, BOULDER_WALLS, out);
  if (!found) throw new Error(`no wall found near (${x}, ${z}) — layout should always have walls`);
  return out;
}

describe('boulder layout (Task 17)', () => {
  it('has 3 clusters of 2–4 boxes', () => {
    expect(BOULDER_CLUSTERS.length).toBe(3);
    for (const cluster of BOULDER_CLUSTERS) {
      expect(cluster.length).toBeGreaterThanOrEqual(2);
      expect(cluster.length).toBeLessThanOrEqual(4);
    }
    expect(BOULDER_WALLS.length).toBe(BOULDER_CLUSTERS.reduce((n, c) => n + c.length, 0));
  });

  it('stands every box at least WALL_KICK_MIN_HEIGHT_M tall', () => {
    for (const box of BOULDER_WALLS) {
      expect(box.halfExtents.y * 2).toBeGreaterThanOrEqual(WALL_KICK_MIN_HEIGHT_M);
    }
  });

  it('keeps every box footprint clear of both spawn points', () => {
    for (const box of BOULDER_WALLS) {
      for (const s of SPAWNS) {
        const dx = Math.max(Math.abs(box.center.x - s.x) - box.halfExtents.x, 0);
        const dz = Math.max(Math.abs(box.center.z - s.z) - box.halfExtents.z, 0);
        expect(Math.hypot(dx, dz)).toBeGreaterThan(5);
      }
    }
  });
});

describe('nearestWall probe', () => {
  it('measures distance to the nearest face and points away from it', () => {
    // West cluster's first box: center (-10, -6), halfX 1.2 → east face at
    // x = -8.8. Standing 0.5m off that face must read 0.5m and away = +x.
    const box = BOULDER_CLUSTERS[0][0];
    const px = box.center.x + box.halfExtents.x + 0.5;
    const p = probe(px, box.center.z);
    expect(p.proximityM).toBeCloseTo(0.5, 5);
    expect(p.awayX).toBeCloseTo(1, 5);
    expect(Math.abs(p.awayZ)).toBeLessThan(1e-9);
  });

  it('never reports a wall inside the wallKick radius while standing at spawn', () => {
    for (const s of SPAWNS) {
      const p = probe(s.x, s.z);
      expect(p.proximityM).toBeGreaterThanOrEqual(MOVES.wallKick.requiresWallWithinM ?? 0);
    }
  });

  it('resolves an inside-footprint point to a face with a sane away direction', () => {
    const box = BOULDER_WALLS[0];
    const p = probe(box.center.x, box.center.z);
    expect(p.proximityM).toBe(0);
    expect(Math.hypot(p.awayX, p.awayZ)).toBeCloseTo(1, 5);
  });
});

describe('wallKick resolves with the production wall probe (T14-P1 hard carry)', () => {
  function makePairNearWall(): {
    player: FighterSim;
    dummy: FighterSim;
    world: FighterSimWorld;
    wallProbe: WallProbe;
  } {
    const player = new FighterSim('rabbit', 'player', true);
    const dummy = new FighterSim('wolf', 'wolf1', false);

    // Stand the player 0.5m east of the west cluster's first box, facing
    // +x (heading -π/2 → forward = (-sin h, -cos h) = (1, 0)).
    const box = BOULDER_CLUSTERS[0][0];
    player.state.pos.x = box.center.x + box.halfExtents.x + 0.5;
    player.state.pos.z = box.center.z;
    player.state.heading = -Math.PI / 2;

    // Dummy 1.6m away — inside wallKick's 2.0m reach, outside punch's 1.5m,
    // so the resolver's wallKick row is the only offer.
    dummy.state.pos.x = player.state.pos.x + 1.6;
    dummy.state.pos.z = player.state.pos.z;
    dummy.state.heading = Math.PI / 2; // faces back at the player
    dummy.state.hp = 20; // wallKick's 25 finishes the wolf

    const wallProbe = probe(player.state.pos.x, player.state.pos.z);
    const world: FighterSimWorld = {
      fighters: [player.state, dummy.state],
      downedBodyNearby: false,
      weaponOnGroundNearby: false,
      wall: wallProbe,
    };
    return { player, dummy, world, wallProbe };
  }

  it('resolver offers wallKick and the special lands with a probe-derived wall', () => {
    const { player, dummy, world, wallProbe } = makePairNearWall();

    // The layout really does put a kickable wall inside the 0.9m gate.
    expect(wallProbe.proximityM).toBeLessThan(MOVES.wallKick.requiresWallWithinM ?? 0);

    // One attack press → the resolver routes to wallKick (not punch).
    player.update(STEP_MS, {
      moveX: 0,
      moveZ: 0,
      lookDX: 0,
      lookDY: 0,
      pressed: { attack: true, jump: false, crouch: false },
      held: { attack: false, jump: false, crouch: false },
    }, world);
    expect(player.state.phase.moveId).toBe('wallKick');

    // Ride startup → active and land the strike through the sim surface,
    // exactly as game.ts routes specials (applySpecialStrike).
    const victims = [dummy.state];
    let hits: HitEvent[] = [];
    for (let i = 0; i < 200 && hits.length === 0; i++) {
      player.update(STEP_MS, null, world);
      hits = player.collectHits(victims);
    }
    expect(hits.length).toBe(1);
    expect(hits[0].moveId).toBe('wallKick');

    const effect = player.applySpecialStrike(hits[0], world.fighters);
    expect(effect).not.toBeNull();

    // Victim KO'd (hp 20 < the 25 damage); attacker launched AWAY from the
    // wall (east face → away = +x) at the tuning launch speed.
    expect(dummy.state.phase.t).toBe('ko');
    expect(player.state.pushX).toBeCloseTo(wallProbe.awayX * WALL_KICK_LAUNCH_MPS, 5);
    expect(player.state.pushZ).toBeCloseTo(wallProbe.awayZ * WALL_KICK_LAUNCH_MPS, 5);
  });

  it('the same press far from any wall does NOT offer wallKick (gate intact)', () => {
    const { player, dummy, world } = makePairNearWall();
    // Teleport both to the open field (spawn area is probe-verified clear).
    player.state.pos.x = 0;
    player.state.pos.z = 0;
    dummy.state.pos.x = 1.2;
    dummy.state.pos.z = 0;
    world.wall = probe(0, 0);
    expect(world.wall.proximityM).toBeGreaterThanOrEqual(MOVES.wallKick.requiresWallWithinM ?? 0);

    player.update(STEP_MS, {
      moveX: 0,
      moveZ: 0,
      lookDX: 0,
      lookDY: 0,
      pressed: { attack: true, jump: false, crouch: false },
      held: { attack: false, jump: false, crouch: false },
    }, world);
    expect(player.state.phase.moveId).toBe('punch');
  });
});
