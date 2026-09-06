import { asc, desc, eq, sql } from 'drizzle-orm';
import { db } from './index.js';
import { matches, matchPlayers, players } from './schema.js';
import type { ServerGameState } from '../game/types.js';
import type { Team } from '@dustline/shared';

/**
 * Persistence layer for player/match stats.
 *
 * Every exported function is best-effort: DB errors are logged (console.error)
 * and swallowed so persistence can never break the game loop or the
 * websocket path.
 */

/** Per-player per-match stats snapshot (matches game/player.ts PlayerStats). */
export interface PlayerMatchStats {
  username: string;
  team: Team;
  kills: number;
  deaths: number;
  assists: number;
  headshots: number;
  shotsFired: number;
  shotsHit: number;
  damageDealt: number;
}

export interface LeaderboardEntry {
  username: string;
  totalKills: number;
  totalDeaths: number;
  kd: number;
  headshots: number;
  matches: number;
  wins: number;
  losses: number;
  accuracy: number;
}

/** Engine score formula (see getPlayerStats in game/engine.ts). */
function matchScore(s: Pick<PlayerMatchStats, 'kills' | 'deaths' | 'headshots'>): number {
  return s.kills * 100 - s.deaths * 50 + s.headshots * 50;
}

interface Accumulation {
  kills: number;
  deaths: number;
  headshots: number;
  shotsFired: number;
  shotsHit: number;
  damageDealt: number;
  matchCount: number;
  wins: number;
  losses: number;
}

/**
 * Upsert a players row (natural key: username) accumulating the given deltas
 * and recomputing kd_ratio from the ACCUMULATED totals (0 deaths -> kd = total
 * kills, never NaN/Infinity). Accumulation happens inside the upsert statement
 * so overlapping persist paths cannot lose updates.
 */
async function upsertPlayerAccumulation(username: string, acc: Accumulation): Promise<number> {
  const [row] = await db
    .insert(players)
    .values({
      username,
      totalKills: acc.kills,
      totalDeaths: acc.deaths,
      totalMatches: acc.matchCount,
      wins: acc.wins,
      losses: acc.losses,
      headshots: acc.headshots,
      shotsFired: acc.shotsFired,
      shotsHit: acc.shotsHit,
      damageDealt: acc.damageDealt,
      kdRatio: acc.deaths > 0 ? acc.kills / acc.deaths : acc.kills,
    })
    .onConflictDoUpdate({
      target: players.username,
      set: {
        totalKills: sql`${players.totalKills} + ${acc.kills}`,
        totalDeaths: sql`${players.totalDeaths} + ${acc.deaths}`,
        totalMatches: sql`${players.totalMatches} + ${acc.matchCount}`,
        wins: sql`${players.wins} + ${acc.wins}`,
        losses: sql`${players.losses} + ${acc.losses}`,
        headshots: sql`${players.headshots} + ${acc.headshots}`,
        shotsFired: sql`${players.shotsFired} + ${acc.shotsFired}`,
        shotsHit: sql`${players.shotsHit} + ${acc.shotsHit}`,
        damageDealt: sql`${players.damageDealt} + ${acc.damageDealt}`,
        kdRatio: sql`CASE WHEN ${players.totalDeaths} + ${acc.deaths} > 0
          THEN (${players.totalKills} + ${acc.kills})::real / (${players.totalDeaths} + ${acc.deaths})
          ELSE (${players.totalKills} + ${acc.kills})::real END`,
        updatedAt: new Date(),
      },
    })
    .returning({ id: players.id });
  return row.id;
}

/**
 * Persist a finished match: one matches row plus one match_players row per
 * participant, and accumulate each participant's players totals (winners get
 * a win, everyone else a loss). Idempotent per match uuid — a repeated call
 * for an already-persisted match is a no-op.
 */
export async function persistMatchEnd(state: ServerGameState, winner: Team): Promise<void> {
  // Snapshot synchronously (before the first await): the engine keeps running
  // and will reset player stats when the next match starts.
  const payload = {
    matchUuid: state.match.id,
    mapName: state.match.mapData.name,
    tScore: state.match.tScore,
    ctScore: state.match.ctScore,
    startedAt: new Date(state.match.startTime),
    endedAt: new Date(state.match.endTime),
    participants: Array.from(state.players.values()).map<PlayerMatchStats>(p => ({
      username: p.username,
      team: p.team,
      kills: p.stats.kills,
      deaths: p.stats.deaths,
      assists: p.stats.assists,
      headshots: p.stats.headshots,
      shotsFired: p.stats.shotsFired,
      shotsHit: p.stats.shotsHit,
      damageDealt: p.stats.damageDealt,
    })),
  };

  try {
    // Idempotency guard: match_uuid is unique; a duplicate persist attempt
    // must not double-accumulate player totals.
    const existing = await db
      .select({ id: matches.id })
      .from(matches)
      .where(eq(matches.matchUuid, payload.matchUuid));
    if (existing.length > 0) return;

    const [match] = await db
      .insert(matches)
      .values({
        matchUuid: payload.matchUuid,
        mapName: payload.mapName,
        status: 'ended',
        tScore: payload.tScore,
        ctScore: payload.ctScore,
        winner,
        startedAt: payload.startedAt,
        endedAt: payload.endedAt,
      })
      .returning({ id: matches.id });

    for (const p of payload.participants) {
      const won = winner === p.team;
      const playerId = await upsertPlayerAccumulation(p.username, {
        kills: p.kills,
        deaths: p.deaths,
        headshots: p.headshots,
        shotsFired: p.shotsFired,
        shotsHit: p.shotsHit,
        damageDealt: p.damageDealt,
        matchCount: 1,
        wins: won ? 1 : 0,
        losses: won ? 0 : 1,
      });
      await db.insert(matchPlayers).values({
        matchId: match.id,
        playerId,
        team: p.team,
        kills: p.kills,
        deaths: p.deaths,
        assists: p.assists,
        headshots: p.headshots,
        shotsFired: p.shotsFired,
        shotsHit: p.shotsHit,
        damageDealt: p.damageDealt,
        score: matchScore(p),
      });
    }
  } catch (err) {
    console.error('[persistence] failed to persist match end:', err);
  }
}

/**
 * Best-effort persist of a player leaving mid-match: accumulate their
 * per-match stats into the players row without counting a match (the match
 * row / match_players rows are only written at match end).
 */
export async function persistDisconnectStats(stats: {
  username: string;
  kills: number;
  deaths: number;
  headshots: number;
  shotsFired: number;
  shotsHit: number;
  damageDealt: number;
}): Promise<void> {
  try {
    await upsertPlayerAccumulation(stats.username, {
      kills: stats.kills,
      deaths: stats.deaths,
      headshots: stats.headshots,
      shotsFired: stats.shotsFired,
      shotsHit: stats.shotsHit,
      damageDealt: stats.damageDealt,
      matchCount: 0,
      wins: 0,
      losses: 0,
    });
  } catch (err) {
    console.error('[persistence] failed to persist disconnect stats:', err);
  }
}

/**
 * Top players ordered by kd_ratio desc, tie-break total_kills desc (then
 * username asc for full determinism). accuracy = shots_hit / shots_fired,
 * 0 when the player never fired.
 */
export async function getLeaderboard(limit: number): Promise<LeaderboardEntry[]> {
  try {
    const rows = await db
      .select({
        username: players.username,
        totalKills: players.totalKills,
        totalDeaths: players.totalDeaths,
        kdRatio: players.kdRatio,
        headshots: players.headshots,
        totalMatches: players.totalMatches,
        wins: players.wins,
        losses: players.losses,
        shotsFired: players.shotsFired,
        shotsHit: players.shotsHit,
      })
      .from(players)
      .orderBy(desc(players.kdRatio), desc(players.totalKills), asc(players.username))
      .limit(limit);
    return rows.map(r => ({
      username: r.username,
      totalKills: r.totalKills,
      totalDeaths: r.totalDeaths,
      kd: r.kdRatio,
      headshots: r.headshots,
      matches: r.totalMatches,
      wins: r.wins,
      losses: r.losses,
      accuracy: r.shotsFired > 0 ? r.shotsHit / r.shotsFired : 0,
    }));
  } catch (err) {
    console.error('[persistence] failed to load leaderboard:', err);
    return [];
  }
}
