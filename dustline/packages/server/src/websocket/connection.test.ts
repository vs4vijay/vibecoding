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

/**
 * Stub the ping interval and console for the connection lifecycle, like
 * rtt.test.ts does. Returns a restore function.
 */
function stubConnectionEnv(opened: { fn: () => void; ms: number }[]): () => void {
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  const realLog = console.log;
  (globalThis as unknown as { setInterval: unknown }).setInterval = (fn: () => void, ms: number) => {
    opened.push({ fn, ms });
    return { id: 'fake-ping-timer' };
  };
  (globalThis as unknown as { clearInterval: unknown }).clearInterval = () => {};
  console.log = () => {};
  return () => {
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
    console.log = realLog;
  };
}

function sentMessages(ws: FakeWs): { type: string;[key: string]: unknown }[] {
  return ws.sent.map(d => JSON.parse(d));
}

describe('hit confirmation (connection)', () => {
  it('sends {type:"hit"} to the shooter when their bullet lands, not to the victim', () => {
    const opened: { fn: () => void; ms: number }[] = [];
    const restore = stubConnectionEnv(opened);
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

      const shooterHits = sentMessages(shooterWs).filter(m => m.type === 'hit');
      expect(shooterHits.length).toBe(1);
      const hit = shooterHits[0]!;
      expect(hit.shooterId).toBe(shooter.id);
      expect(hit.damage).toBeGreaterThan(0);
      expect(hit.healthLeft).toBe(victim.health);
      expect(hit.healthLeft).toBeLessThan(100);

      // The victim's socket never receives the shooter's hit confirmation.
      const victimHits = sentMessages(victimWs).filter(m => m.type === 'hit');
      expect(victimHits.length).toBe(0);

      handleClose(shooterWs);
      handleClose(victimWs);
    } finally {
      restore();
    }
  });
});

describe('kill/death notifications (connection)', () => {
  it('broadcasts {type:"kill"} to every client and sends {type:"death"} to the victim on a lethal shot', () => {
    const opened: { fn: () => void; ms: number }[] = [];
    const restore = stubConnectionEnv(opened);
    try {
      const shooterWs = makeFakeWs();
      const victimWs = makeFakeWs();
      const bystanderWs = makeFakeWs(); // connected but never joined
      handleOpen(shooterWs);
      handleOpen(victimWs);
      handleOpen(bystanderWs);
      handleMessage(shooterWs, JSON.stringify({ type: 'join', username: 'shooter', team: 'T' }));
      handleMessage(victimWs, JSON.stringify({ type: 'join', username: 'victim', team: 'CT' }));

      const state = getGameState();
      const shooter = state.players.get(shooterWs.data.playerId!)!;
      const victim = state.players.get(victimWs.data.playerId!)!;
      shooter.position = { x: -20, y: 0.9, z: -25 };
      victim.position = { x: -15, y: 0.9, z: -25 };
      tick(state);

      // One lethal body shot.
      victim.armor = 0;
      victim.health = 10;
      withZeroSpread(() => {
        handleMessage(shooterWs, JSON.stringify({ type: 'input', data: FIRE_INPUT }));
      });
      tick(state);
      expect(victim.isDead).toBe(true);

      // `kill` has no target field in the shared message: broadcast to every
      // client (the kill feed resolves usernames from the snapshot).
      for (const ws of [shooterWs, victimWs, bystanderWs]) {
        const kills = sentMessages(ws).filter(m => m.type === 'kill');
        expect(kills).toEqual([{
          type: 'kill',
          killerId: shooter.id,
          victimId: victim.id,
          weaponName: 'AK-47',
          headshot: false,
        }]);
      }

      // `death` goes to the victim only.
      const victimDeaths = sentMessages(victimWs).filter(m => m.type === 'death');
      expect(victimDeaths).toEqual([{ type: 'death', killerId: shooter.id, weaponName: 'AK-47' }]);
      expect(sentMessages(shooterWs).filter(m => m.type === 'death').length).toBe(0);
      expect(sentMessages(bystanderWs).filter(m => m.type === 'death').length).toBe(0);

      // The killing shot also produced the shooter's hit confirmation.
      const shooterHits = sentMessages(shooterWs).filter(m => m.type === 'hit');
      expect(shooterHits.length).toBe(1);
      expect(shooterHits[0]!.healthLeft).toBe(0);

      handleClose(shooterWs);
      handleClose(victimWs);
      handleClose(bystanderWs);
    } finally {
      restore();
    }
  });
});

// LAST: endMatch schedules a 5 s resetMatch timer we cannot cancel, so this
// test runs after everything else in the file to avoid disturbing it.
describe('match lifecycle notifications (connection)', () => {
  it('broadcasts matchStart when warmup ends and matchEnd when the match timer expires', () => {
    const opened: { fn: () => void; ms: number }[] = [];
    const restore = stubConnectionEnv(opened);
    const realError = console.error;
    console.error = () => {}; // silence best-effort match-end persistence failures
    try {
      const ws = makeFakeWs();
      handleOpen(ws);

      const state = getGameState();

      // Warmup expires → live, and every client learns the match started.
      state.match.timeRemaining = 1;
      tick(state);
      expect(state.match.status).toBe('live');
      expect(sentMessages(ws).filter(m => m.type === 'matchStart')).toEqual([
        { type: 'matchStart', matchId: state.match.id },
      ]);

      // Match timer expires → ended (timeout: CT wins on time).
      state.match.timeRemaining = 1;
      tick(state);
      expect(state.match.status).toBe('ended');
      const ends = sentMessages(ws).filter(m => m.type === 'matchEnd');
      expect(ends.length).toBe(1);
      expect(ends[0]!.winner).toBe('CT');
      expect(typeof ends[0]!.tScore).toBe('number');
      expect(typeof ends[0]!.ctScore).toBe('number');

      handleClose(ws);
    } finally {
      console.error = realError;
      restore();
    }
  });
});
