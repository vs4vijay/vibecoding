// Task 5: Persistent stats + leaderboard — TDD tests.
// Strategy: PGLite in-memory (per-process, matches production db/index.ts),
// direct Hono app.request() for the leaderboard route (no second server),
// real engine/connection wiring for match-end and disconnect persistence.
import { describe, it, expect, beforeAll } from 'bun:test';
// NOTE: drizzle-orm is only installed under packages/server/node_modules (not
// hoisted to the workspace root), so this root-level test file must not import
// it directly — it imports the server source modules, which resolve their own
// dependencies, and filters rows in plain JS.
import { players, matches, matchPlayers } from './packages/server/src/db/schema.ts';
import { db } from './packages/server/src/db/index.ts';
import { ensureSchema } from './packages/server/src/db/migrate.ts';
import * as repository from './packages/server/src/db/repository.ts';
import leaderboardApp from './packages/server/src/leaderboard.ts';
import * as engine from './packages/server/src/game/engine.ts';
import * as connection from './packages/server/src/websocket/connection.ts';
import type { ServerGameState, ServerPlayer } from './packages/server/src/game/types.ts';

// ─── Helpers ─────────────────────────────────────────────
function stats(over: Partial<ServerPlayer['stats']> = {}): ServerPlayer['stats'] {
  return {
    kills: 0, deaths: 0, assists: 0, headshots: 0,
    shotsFired: 0, shotsHit: 0, damageDealt: 0,
    ...over,
  };
}

async function wipeDatabase(): Promise<void> {
  // FK-safe order (match_players references matches + players)
  await db.delete(matchPlayers);
  await db.delete(matches);
  await db.delete(players);
}

async function getPlayerRow(username: string) {
  const rows = await db.select().from(players);
  return rows.find(r => r.username === username) ?? null;
}

async function pollUntil<T>(fn: () => T | null | Promise<T | null>, timeoutMs = 2000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error('pollUntil: condition not met in time');
    await new Promise(r => setTimeout(r, 25));
  }
}

function fakeWs(): Bun.ServerWebSocket<any> {
  return { data: null, readyState: 1, send() {} } as unknown as Bun.ServerWebSocket<any>;
}

async function getLeaderboard(url: string): Promise<{ status: number; body: any[] }> {
  const res = await leaderboardApp.request(url);
  return { status: res.status, body: await res.json() };
}

function seedPlayer(over: Partial<typeof players.$inferInsert> & { username: string }) {
  return db.insert(players).values(over);
}

function twoPlayerState(tName: string, ctName: string): ServerGameState {
  const state = engine.createGameState();
  engine.addPlayer(state, tName, 'T');
  engine.addPlayer(state, ctName, 'CT');
  return state;
}

async function idToUsernameMap(): Promise<Map<number, string>> {
  const rows = await db.select().from(players);
  return new Map(rows.map(r => [r.id, r.username]));
}

// engine.endMatch fires persistence fire-and-forget (the tick loop must never
// wait on the DB), so tests poll for the async writes to land.
async function pollUntilMatchRow(matchUuid: string) {
  return pollUntil(async () => {
    const all = await db.select().from(matches);
    return all.find(m => m.matchUuid === matchUuid) ?? null;
  });
}

// ─── Setup ───────────────────────────────────────────────
beforeAll(async () => {
  // Idempotent boot-time schema creation (run twice deliberately)
  await ensureSchema();
  await ensureSchema();
  await wipeDatabase();
});

// ─── Boot-time schema ────────────────────────────────────
describe('boot-time schema creation', () => {
  it('is idempotent and leaves a usable players table', async () => {
    await seedPlayer({ username: 'SchemaBot' });
    const row = await getPlayerRow('SchemaBot');
    expect(row).not.toBeNull();
    expect(row!.totalKills).toBe(0);
    expect(row!.kdRatio).toBe(0);
  });
});

// ─── Match-end persistence ───────────────────────────────
describe('match end persistence', () => {
  it('writes a matches row with scores, winner and timestamps', async () => {
    const state = twoPlayerState('Row_T', 'Row_CT');
    await engine.endMatch(state, 'T');

    const row = await pollUntilMatchRow(state.match.id);
    expect(row).toBeDefined();
    expect(row!.matchUuid).toBe(state.match.id);
    expect(row!.mapName).toBe('de_dust');
    expect(row!.status).toBe('ended');
    expect(row!.tScore).toBe(1);
    expect(row!.ctScore).toBe(0);
    expect(row!.winner).toBe('T');
    expect(row!.startedAt).not.toBeNull();
    expect(row!.endedAt).not.toBeNull();
  });

  it('does not duplicate rows when the same match is persisted twice', async () => {
    const state = twoPlayerState('Dup_T', 'Dup_CT');
    await engine.endMatch(state, 'T');
    await pollUntilMatchRow(state.match.id); // first persist fully committed
    await engine.endMatch(state, 'T'); // second call must be a no-op

    await new Promise(r => setTimeout(r, 150));
    const allMatches = await db.select().from(matches);
    const dupRows = allMatches.filter(m => m.matchUuid === state.match.id);
    expect(dupRows.length).toBe(1);
  });

  it('writes one match_players row per participant with exact per-match stats', async () => {
    const state = twoPlayerState('MP_T', 'MP_CT');
    const tPlayer = state.players.get(Array.from(state.players.keys())[0])!;
    const ctPlayer = state.players.get(Array.from(state.players.keys())[1])!;
    // Player order in the map is insertion order: first added is T.
    expect(tPlayer.team).toBe('T');
    expect(ctPlayer.team).toBe('CT');
    tPlayer.username = 'MP_Alice';
    ctPlayer.username = 'MP_Bob';
    tPlayer.stats = stats({ kills: 5, deaths: 2, assists: 1, headshots: 2, shotsFired: 40, shotsHit: 12, damageDealt: 480 });
    ctPlayer.stats = stats({ kills: 2, deaths: 5, assists: 0, headshots: 1, shotsFired: 25, shotsHit: 6, damageDealt: 210 });
    await engine.endMatch(state, 'T');

    const match = await pollUntilMatchRow(state.match.id);
    const allMatchPlayers = await pollUntil(async () => {
      const rows = await db.select().from(matchPlayers);
      const forMatch = rows.filter(mp => mp.matchId === match!.id);
      return forMatch.length === 2 ? forMatch : null;
    });
    const rows = allMatchPlayers;
    expect(rows.length).toBe(2);

    const names = await idToUsernameMap();
    const aliceRow = rows.find(r => names.get(r.playerId) === 'MP_Alice');
    const bobRow = rows.find(r => names.get(r.playerId) === 'MP_Bob');
    expect(aliceRow).toBeDefined();
    expect(bobRow).toBeDefined();

    expect(aliceRow!.team).toBe('T');
    expect(aliceRow!.kills).toBe(5);
    expect(aliceRow!.deaths).toBe(2);
    expect(aliceRow!.assists).toBe(1);
    expect(aliceRow!.headshots).toBe(2);
    expect(aliceRow!.shotsFired).toBe(40);
    expect(aliceRow!.shotsHit).toBe(12);
    expect(aliceRow!.damageDealt).toBe(480);
    expect(aliceRow!.score).toBe(500); // 5*100 - 2*50 + 2*50 (engine score formula)

    expect(bobRow!.team).toBe('CT');
    expect(bobRow!.score).toBe(0); // 2*100 - 5*50 + 1*50
  });

  it('upserts players rows accumulating totals and recomputing kd_ratio from ACCUMULATED totals across rejoins', async () => {
    // First match: Alice 5k/2d -> kd 2.5, win; Bob 2k/5d -> kd 0.4, loss
    const first = twoPlayerState('KD_Alice', 'KD_Bob');
    const a1 = Array.from(first.players.values())[0];
    const b1 = Array.from(first.players.values())[1];
    a1.stats = stats({ kills: 5, deaths: 2, headshots: 2, shotsFired: 40, shotsHit: 12, damageDealt: 480 });
    b1.stats = stats({ kills: 2, deaths: 5, headshots: 1, shotsFired: 25, shotsHit: 6, damageDealt: 210 });
    await engine.endMatch(first, 'T');

    // Wait for the first match's persist to fully commit (alice upserted and
    // bob's row present means the whole participants loop finished).
    const alice = await pollUntil(async () => {
      const row = await getPlayerRow('KD_Alice');
      return row && row.totalMatches === 1 ? row : null;
    });
    const bob = await pollUntil(() => getPlayerRow('KD_Bob'));
    expect(bob).not.toBeNull();
    expect(alice!.totalKills).toBe(5);
    expect(alice!.totalDeaths).toBe(2);
    expect(alice!.kdRatio).toBeCloseTo(2.5);
    expect(alice!.totalMatches).toBe(1);
    expect(alice!.wins).toBe(1);
    expect(alice!.losses).toBe(0);
    expect(alice!.headshots).toBe(2);
    expect(alice!.shotsFired).toBe(40);
    expect(alice!.shotsHit).toBe(12);
    expect(alice!.damageDealt).toBe(480);

    expect(bob!.totalMatches).toBe(1);
    expect(bob!.wins).toBe(0);
    expect(bob!.losses).toBe(1);
    expect(bob!.kdRatio).toBeCloseTo(0.4);

    // Second match (rejoin): Alice 3k/0d -> accumulated 8k/2d -> kd 4.0
    const second = twoPlayerState('KD_Alice', 'KD_Bob');
    const a2 = Array.from(second.players.values())[0];
    a2.stats = stats({ kills: 3, deaths: 0, shotsFired: 10, shotsHit: 5, damageDealt: 150 });
    await engine.endMatch(second, 'T');

    const alice2 = await pollUntil(async () => {
      const row = await getPlayerRow('KD_Alice');
      return row && row.totalMatches === 2 ? row : null;
    });
    expect(alice2!.totalKills).toBe(8);
    expect(alice2!.totalDeaths).toBe(2);
    expect(alice2!.kdRatio).toBeCloseTo(4.0); // recomputed from accumulated 8/2, not (2.5+inf)/2
    expect(alice2!.totalMatches).toBe(2);
    expect(alice2!.wins).toBe(2);
    expect(alice2!.losses).toBe(0);
    expect(alice2!.shotsFired).toBe(50);
    expect(alice2!.shotsHit).toBe(17);
    expect(alice2!.damageDealt).toBe(630);
  });
});

// ─── Disconnect mid-match persistence ────────────────────
describe('disconnect persistence', () => {
  it('persists a live-match leaver into players totals without counting a match', async () => {
    const ws = fakeWs();
    connection.handleOpen(ws);
    connection.handleMessage(ws, JSON.stringify({ type: 'join', username: 'LiveLeft', team: 'T' }));
    const state = connection.getGameState();
    const player = state.players.get((ws.data as any).playerId)!;
    player.stats = stats({ kills: 4, deaths: 1, headshots: 1, shotsFired: 20, shotsHit: 7, damageDealt: 200 });
    const prevStatus = state.match.status;
    state.match.status = 'live';

    connection.handleClose(ws);
    state.match.status = prevStatus; // restore shared module state

    const row = await pollUntil(() => getPlayerRow('LiveLeft'));
    expect(row!.totalKills).toBe(4);
    expect(row!.totalDeaths).toBe(1);
    expect(row!.headshots).toBe(1);
    expect(row!.shotsFired).toBe(20);
    expect(row!.shotsHit).toBe(7);
    expect(row!.damageDealt).toBe(200);
    expect(row!.kdRatio).toBeCloseTo(4.0);
    // The match is still running: not a completed match, no win/loss credit
    expect(row!.totalMatches).toBe(0);
    expect(row!.wins).toBe(0);
    expect(row!.losses).toBe(0);
  });

  it('does not persist during warmup (stats would be stale from a banked match)', async () => {
    const ws = fakeWs();
    connection.handleOpen(ws);
    connection.handleMessage(ws, JSON.stringify({ type: 'join', username: 'WarmupLeft', team: 'T' }));
    const state = connection.getGameState();
    state.players.get((ws.data as any).playerId)!.stats = stats({ kills: 9 });
    const prevStatus = state.match.status;
    state.match.status = 'warmup';

    connection.handleClose(ws);
    state.match.status = prevStatus;

    await new Promise(r => setTimeout(r, 300));
    expect(await getPlayerRow('WarmupLeft')).toBeNull();
  });

  it('swallows DB errors (oversized username) instead of throwing into the disconnect path', async () => {
    const errors: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    let threw: unknown = null;
    try {
      await repository.persistDisconnectStats({
        username: 'x'.repeat(40), // exceeds varchar(32) -> DB error
        kills: 1, deaths: 0, headshots: 0, shotsFired: 0, shotsHit: 0, damageDealt: 0,
      });
    } catch (err) {
      threw = err;
    } finally {
      console.error = original;
    }
    expect(threw).toBeNull(); // swallowed, not thrown
    expect(errors.length).toBeGreaterThan(0); // logged instead
  });
});

// ─── Leaderboard endpoint ────────────────────────────────
describe('GET /leaderboard', () => {
  beforeAll(async () => {
    await wipeDatabase();
  });

  it('orders by kd desc with total_kills as tie-break and returns the exact entry shape', async () => {
    await seedPlayer({ username: 'Board_High', totalKills: 10, totalDeaths: 4, kdRatio: 2.5 });
    await seedPlayer({ username: 'Board_TieB', totalKills: 20, totalDeaths: 10, kdRatio: 2.0 });
    await seedPlayer({ username: 'Board_TieA', totalKills: 10, totalDeaths: 5, kdRatio: 2.0 });
    await seedPlayer({ username: 'Board_Low', totalKills: 1, totalDeaths: 3, kdRatio: 0.3333 });

    const { status, body } = await getLeaderboard('/leaderboard');
    expect(status).toBe(200);
    const usernames = body.map((e: any) => e.username);
    expect(usernames).toEqual(['Board_High', 'Board_TieB', 'Board_TieA', 'Board_Low']);

    for (const entry of body) {
      expect(Object.keys(entry).sort()).toEqual([
        'accuracy', 'headshots', 'kd', 'losses', 'matches',
        'totalDeaths', 'totalKills', 'username', 'wins',
      ]);
    }
    expect(body[0]).toMatchObject({
      username: 'Board_High',
      totalKills: 10,
      totalDeaths: 4,
      kd: 2.5,
      matches: 0,
      wins: 0,
      losses: 0,
    });
  });

  it('computes accuracy = shots_hit / shots_fired and 0 when no shots', async () => {
    await seedPlayer({ username: 'Acc_Shooter', shotsFired: 8, shotsHit: 5 });
    await seedPlayer({ username: 'Acc_Pacifist', shotsFired: 0, shotsHit: 0 });

    const { body } = await getLeaderboard('/leaderboard');
    const shooter = body.find((e: any) => e.username === 'Acc_Shooter');
    const pacifist = body.find((e: any) => e.username === 'Acc_Pacifist');
    expect(shooter).toBeDefined();
    expect(pacifist).toBeDefined();
    expect(shooter!.accuracy).toBeCloseTo(0.625);
    expect(pacifist!.accuracy).toBe(0);
  });

  it('clamps limit: default 20, max 100, min 1, garbage falls back to default', async () => {
    for (let i = 0; i < 105; i++) {
      await seedPlayer({ username: `LimitBot_${String(i).padStart(3, '0')}`, totalKills: i, kdRatio: i });
    }

    expect((await getLeaderboard('/leaderboard')).body.length).toBe(20);
    expect((await getLeaderboard('/leaderboard?limit=5')).body.length).toBe(5);
    expect((await getLeaderboard('/leaderboard?limit=1000')).body.length).toBe(100);
    expect((await getLeaderboard('/leaderboard?limit=0')).body.length).toBe(1);
    expect((await getLeaderboard('/leaderboard?limit=abc')).body.length).toBe(20);
  });
});
