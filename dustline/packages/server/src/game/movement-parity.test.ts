import { describe, it, expect } from 'bun:test';
import { createPlayer, processPlayerInput, toPlayerState } from './player.js';
// Test-only cross-package import (excluded from tsc builds): the client's
// predicted movement must mirror the server's simulation exactly, so the
// parity proof has to drive both implementations side by side.
import { applyLocalInput, extractLocalState, SIMULATION_DT } from '../../../client/src/movement.js';
import { DEFAULT_MAP, PLAYER_HEIGHT, PLAYER_SPEED, type InputState } from '@dustline/shared';

const DT = SIMULATION_DT;

const mkInput = (over: Partial<InputState>): InputState => ({
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
  ...over,
});

/** Deterministic input script; `push(n, ...)` appends n identical ticks. */
function buildScript(): InputState[] {
  const script: InputState[] = [];
  const push = (ticks: number, over: Partial<InputState>) => {
    for (let i = 0; i < ticks; i++) script.push(mkInput(over));
  };

  // Start at (-8, 0.9, -20): on the floor in the spawn rest state (feet sunk
  // 0.1 into the floor's top), clear of every prop except the ground.
  push(55, { forward: true });                      // slide along the floor (the fixed standing-contact path)
  push(30, { forward: true, yaw: Math.PI / 2 });    // run east into box-t2 and get blocked by it
  push(1, { forward: true, jump: true, yaw: Math.PI / 2 }); // jump while pressed against the box
  push(50, { forward: true, yaw: Math.PI / 2 });    // climb over the box edge mid-air and land on top
  push(30, { forward: true, yaw: Math.PI / 2 });    // walk across the box top and off its far edge
  push(30, {});                                     // fall to the floor and settle
  push(40, { left: true });                         // strafe along the floor
  push(30, { backward: true });                     // walk backward
  return script;
}

describe('client/server movement parity', () => {
  it('predicts bit-identical movement to the server over a scripted run on and around the floor', () => {
    const serverPlayer = createPlayer('parity', 'T');
    serverPlayer.position = { x: -8, y: PLAYER_HEIGHT / 2, z: -20 };
    serverPlayer.rotation = { x: 0, y: 0 };
    let client = extractLocalState(toPlayerState(serverPlayer));

    const entities = DEFAULT_MAP.entities;
    const script = buildScript();

    for (let t = 0; t < script.length; t++) {
      const input = script[t];
      input.seq = t + 1;
      processPlayerInput(serverPlayer, input, entities, DT);
      client = applyLocalInput(client, input, entities, DT);

      // Bit-identical: Object.is on every simulated field, every tick.
      expect(client.position.x).toBe(serverPlayer.position.x);
      expect(client.position.y).toBe(serverPlayer.position.y);
      expect(client.position.z).toBe(serverPlayer.position.z);
      expect(client.velocity.x).toBe(serverPlayer.velocity.x);
      expect(client.velocity.y).toBe(serverPlayer.velocity.y);
      expect(client.velocity.z).toBe(serverPlayer.velocity.z);
      expect(client.onGround).toBe(serverPlayer.onGround);

      if (t === 0) {
        // The first tick must slide along the floor, not snap to the floor
        // entity's boundary (the pre-fix bug teleported z to -30.31 / +30.31).
        expect(serverPlayer.position.z).toBeCloseTo(-20 + PLAYER_SPEED * DT, 12);
        expect(client.position.z).toBe(serverPlayer.position.z);
      }
    }
  });
});
