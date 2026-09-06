import { describe, it, expect } from 'bun:test';
import { handleOpen, handleClose, handleMessage, getGameState } from './connection.js';
import { tick } from '../game/engine.js';

interface FakeWs {
  readyState: number;
  sent: string[];
  data: { playerId: string | null };
  send(data: string): void;
}

function makeFakeWs(): FakeWs {
  return {
    readyState: 1,
    sent: [],
    data: { playerId: null },
    send(data: string) {
      this.sent.push(data);
    },
  };
}

/** Deterministic fire: fireWeapon derives spread from Math.random(). */
function withZeroSpread<T>(fn: () => T): T {
  const random = Math.random;
  Math.random = () => 0.5; // (0.5 - 0.5) * 2 * spread === 0
  try {
    return fn();
  } finally {
    Math.random = random;
  }
}

const FIRE_INPUT = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  jump: false,
  walk: false,
  fire: true,
  reload: false,
  weaponSlot: null,
  yaw: Math.PI / 2, // aims along +x
  pitch: -0.334,
  seq: 1,
  timestamp: 0,
};

describe('hit confirmation (connection)', () => {
  it('sends {type:"hit"} to the shooter when their bullet lands, not to the victim', () => {
    const opened: { fn: () => void; ms: number }[] = [];
    const realSetInterval = globalThis.setInterval;
    const realClearInterval = globalThis.clearInterval;
    const realLog = console.log;
    (globalThis as unknown as { setInterval: unknown }).setInterval = (fn: () => void, ms: number) => {
      opened.push({ fn, ms });
      return { id: 'fake-ping-timer' };
    };
    (globalThis as unknown as { clearInterval: unknown }).clearInterval = () => {};
    console.log = () => {}; // silence connection lifecycle logs
    try {
      const shooterWs = makeFakeWs();
      const victimWs = makeFakeWs();
      handleOpen(shooterWs);
      handleOpen(victimWs);
      handleMessage(shooterWs, JSON.stringify({ type: 'join', username: 'shooter', team: 'T' }));
      handleMessage(victimWs, JSON.stringify({ type: 'join', username: 'victim', team: 'CT' }));
      expect(shooterWs.data.playerId).not.toBeNull();
      expect(victimWs.data.playerId).not.toBeNull();

      // Stand the target on the shooter's +x ray, one tick of history so the
      // rewind path has a frame to consult.
      const state = getGameState();
      const shooter = state.players.get(shooterWs.data.playerId!)!;
      const victim = state.players.get(victimWs.data.playerId!)!;
      shooter.position = { x: -20, y: 0.9, z: -25 };
      victim.position = { x: -15, y: 0.9, z: -25 };
      tick(state);

      withZeroSpread(() => {
        handleMessage(shooterWs, JSON.stringify({ type: 'input', data: FIRE_INPUT }));
      });
      tick(state); // resolves the bullet against the target

      const shooterHits = shooterWs.sent.map(d => JSON.parse(d)).filter(m => m.type === 'hit');
      expect(shooterHits.length).toBe(1);
      const hit = shooterHits[0]!;
      expect(hit.shooterId).toBe(shooter.id);
      expect(hit.damage).toBeGreaterThan(0);
      expect(hit.healthLeft).toBe(victim.health);
      expect(hit.healthLeft).toBeLessThan(100);

      // The victim's socket never receives the shooter's hit confirmation.
      const victimHits = victimWs.sent.map(d => JSON.parse(d)).filter(m => m.type === 'hit');
      expect(victimHits.length).toBe(0);

      handleClose(shooterWs);
      handleClose(victimWs);
    } finally {
      globalThis.setInterval = realSetInterval;
      globalThis.clearInterval = realClearInterval;
      console.log = realLog;
    }
  });
});
