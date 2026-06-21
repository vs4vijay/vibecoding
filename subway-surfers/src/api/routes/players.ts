import { Elysia, t } from "elysia";
import { getDb } from "../../db/database.ts";
import { players, runs } from "../../db/schema.ts";
import { eq, desc, and, gte } from "drizzle-orm";

export const playersRouter = new Elysia({ prefix: "/api/players" })
  // Get or create a player by username
  .post(
    "/get-or-create",
    async ({ body }) => {
      const db = getDb();
      const { username, displayName } = body;

      let player = await db
        .select()
        .from(players)
        .where(eq(players.username, username))
        .limit(1)
        .then((rows) => rows[0]);

      if (!player) {
        const [newPlayer] = await db
          .insert(players)
          .values({
            username,
            displayName: displayName || username,
          })
          .returning();
        player = newPlayer;
      }

      return player;
    },
    {
      body: t.Object({
        username: t.String({ minLength: 2, maxLength: 50 }),
        displayName: t.Optional(t.String({ maxLength: 100 })),
      }),
    },
  )

  // Get player profile
  .get("/:id", async ({ params }) => {
    const db = getDb();
    const player = await db
      .select()
      .from(players)
      .where(eq(players.id, params.id))
      .limit(1)
      .then((rows) => rows[0]);

    if (!player) {
      return { error: "Player not found" };
    }

    // Get last 5 runs
    const recentRuns = await db
      .select()
      .from(runs)
      .where(eq(runs.playerId, player.id))
      .orderBy(desc(runs.playedAt))
      .limit(5);

    return { player, recentRuns };
  })

  // Update player stats after a run
  .patch(
    "/:id/stats",
    async ({ params, body }) => {
      const db = getDb();
      const { score, distance, coinsCollected } = body;

      const player = await db
        .select()
        .from(players)
        .where(eq(players.id, params.id))
        .limit(1)
        .then((rows) => rows[0]);

      if (!player) {
        return { error: "Player not found" };
      }

      const newHighScore = Math.max(player.highScore, score);

      const [updated] = await db
        .update(players)
        .set({
          totalDistance: player.totalDistance + Math.floor(distance),
          totalCoins: player.totalCoins + coinsCollected,
          highScore: newHighScore,
          gamesPlayed: player.gamesPlayed + 1,
          updatedAt: new Date(),
        })
        .where(eq(players.id, player.id))
        .returning();

      return updated;
    },
    {
      body: t.Object({
        score: t.Integer(),
        distance: t.Number(),
        coinsCollected: t.Integer(),
      }),
    },
  );
