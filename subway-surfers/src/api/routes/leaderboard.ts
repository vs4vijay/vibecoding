import { Elysia, t } from "elysia";
import { getDb } from "../../db/database.ts";
import { players, achievements, playerAchievements } from "../../db/schema.ts";
import { desc, eq, count, sql } from "drizzle-orm";

export const leaderboardRouter = new Elysia({
  prefix: "/api/leaderboard",
})
  // Global leaderboard by high score
  .get(
    "/score",
    async ({ query }) => {
      const db = getDb();
      const { limit } = query;

      const result = await db
        .select({
          rank: sql<number>`ROW_NUMBER() OVER (ORDER BY ${players.highScore} DESC)`,
          id: players.id,
          username: players.username,
          displayName: players.displayName,
          avatarUrl: players.avatarUrl,
          highScore: players.highScore,
          gamesPlayed: players.gamesPlayed,
          totalDistance: players.totalDistance,
          achievementsUnlocked: sql<number>`(
            SELECT COUNT(*)::int FROM ${playerAchievements}
            WHERE ${playerAchievements.playerId} = ${players.id}
          )`,
        })
        .from(players)
        .orderBy(desc(players.highScore))
        .limit(limit);

      return result;
    },
    {
      query: t.Object({
        limit: t.Optional(t.Integer()),
      }),
    },
  )

  // Leaderboard by total distance
  .get(
    "/distance",
    async ({ query }) => {
      const db = getDb();
      const { limit } = query;

      const result = await db
        .select({
          rank: sql<number>`ROW_NUMBER() OVER (ORDER BY ${players.totalDistance} DESC)`,
          id: players.id,
          username: players.username,
          displayName: players.displayName,
          avatarUrl: players.avatarUrl,
          totalDistance: players.totalDistance,
          gamesPlayed: players.gamesPlayed,
        })
        .from(players)
        .orderBy(desc(players.totalDistance))
        .limit(limit);

      return result;
    },
    {
      query: t.Object({
        limit: t.Optional(t.Integer()),
      }),
    },
  )

  // Get player rank
  .get(
    "/rank/:playerId",
    async ({ params }) => {
      const db = getDb();

      const player = await db
        .select({
          highScore: players.highScore,
          totalDistance: players.totalDistance,
        })
        .from(players)
        .where(eq(players.id, params.playerId))
        .limit(1)
        .then((rows) => rows[0]);

      if (!player) {
        return { error: "Player not found" };
      }

      // Score rank
      const scoreRank = await db
        .select({
          rank: sql<number>`COUNT(*)::int + 1`,
        })
        .from(players)
        .where(sql`${players.highScore} > ${player.highScore}`)
        .then((rows) => rows[0]?.rank ?? 1);

      // Distance rank
      const distanceRank = await db
        .select({
          rank: sql<number>`COUNT(*)::int + 1`,
        })
        .from(players)
        .where(sql`${players.totalDistance} > ${player.totalDistance}`)
        .then((rows) => rows[0]?.rank ?? 1);

      return {
        scoreRank,
        distanceRank,
        highScore: player.highScore,
        totalDistance: player.totalDistance,
      };
    },
  );
