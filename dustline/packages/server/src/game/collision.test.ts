import { describe, it, expect } from 'bun:test';
import { resolvePlayerCollision, entityToAABB } from './collision.js';
import { createPlayer, processPlayerInput } from './player.js';
import {
  DEFAULT_MAP,
  PLAYER_HEIGHT,
  PLAYER_JUMP_FORCE,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  type Vec3,
} from '@dustline/shared';

const DT = 1 / 60;

// T spawn 0, clear of every prop: the only entity overlapping the player
// there is the ground. The spawn/clamp rest height (y = PLAYER_HEIGHT / 2)
// puts the player's feet 0.1 inside the floor's top surface (y = 0.1), which
// is the standing state this suite pins down.
const SPAWN = DEFAULT_MAP.spawnPoints[0].position;
const restPosition = (): Vec3 => ({ x: SPAWN.x, y: PLAYER_HEIGHT / 2, z: SPAWN.z });

describe('resolvePlayerCollision (floor standing contact)', () => {
  it('slides along the floor instead of snapping to its boundary', () => {
    const velocity: Vec3 = { x: 0, y: 0, z: PLAYER_SPEED };
    const result = resolvePlayerCollision(restPosition(), velocity, DEFAULT_MAP.entities, DT);

    // Moved forward by exactly one tick of movement, not teleported to the
    // floor entity's boundary (the old bug snapped z to -30.31).
    expect(result.position.z).toBeCloseTo(SPAWN.z + PLAYER_SPEED * DT, 12);
    expect(result.position.x).toBe(SPAWN.x);
    expect(result.onGround).toBe(true);
  });

  it('does not snap when jumping and moving horizontally in the same tick', () => {
    const velocity: Vec3 = { x: 0, y: PLAYER_JUMP_FORCE, z: PLAYER_SPEED };
    const result = resolvePlayerCollision(restPosition(), velocity, DEFAULT_MAP.entities, DT);

    expect(result.position.z).toBeCloseTo(SPAWN.z + PLAYER_SPEED * DT, 12);
    expect(result.position.y).toBeCloseTo(PLAYER_HEIGHT / 2 + PLAYER_JUMP_FORCE * DT, 12);
    expect(result.onGround).toBe(false);
  });

  it('still blocks horizontal movement against a genuine wall while standing on the floor', () => {
    // Just outside wall-north's face (max.z = -29.75): the player overlaps
    // only the floor before moving, the wall only after moving.
    const start: Vec3 = { x: SPAWN.x, y: PLAYER_HEIGHT / 2, z: -29.4 };
    const velocity: Vec3 = { x: 0, y: 0, z: -PLAYER_SPEED };
    const result = resolvePlayerCollision(start, velocity, DEFAULT_MAP.entities, DT);

    const wall = entityToAABB(DEFAULT_MAP.entities.find(e => e.id === 'wall-north')!);
    expect(result.position.z).toBeCloseTo(wall.max.z + PLAYER_RADIUS + 0.01, 12);
    expect(result.onGround).toBe(true);
  });
});

describe('processPlayerInput (floor standing contact)', () => {
  it('moves a grounded player forward instead of teleporting them to the floor boundary', () => {
    const player = createPlayer('floor-repro', 'T');
    player.position = restPosition();
    player.rotation = { x: 0, y: 0 }; // yaw 0: forward = +z

    processPlayerInput(
      player,
      { forward: true, backward: false, left: false, right: false, jump: false, walk: false, yaw: 0, pitch: 0 },
      DEFAULT_MAP.entities,
      DT
    );

    expect(player.position.z).toBeCloseTo(SPAWN.z + PLAYER_SPEED * DT, 12);
    expect(player.position.x).toBeCloseTo(SPAWN.x, 12);
    expect(player.position.y).toBe(PLAYER_HEIGHT / 2);
    expect(player.onGround).toBe(true);
  });
});
