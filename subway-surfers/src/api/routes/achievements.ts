import { Elysia, t } from "elysia";
import { getDb } from "../../db/database.ts";
import {
  achievements,
  playerAchievements,
} from "../../db/schema.ts";
import { eq, sql } from "drizzle-orm";

export const achievementsRouter = new Elysia({
  prefix: "/api/achievements",
})
  // List all achievements with unlock status for a player
  .get(
    "/",
    async ({ query }) => {
      const db = getDb();
      const { playerId } = query;

      const allAchievements = await db.select().from(achievements);

      if (!playerId) {
        return allAchievements;
      }

      const unlockedIds = await db
        .select({ achievementId: playerAchievements.achievementId })
        .from(playerAchievements)
        .where(eq(playerAchievements.playerId, playerId))
        .then((rows) => new Set(rows.map((r) => r.achievementId)));

      return allAchievements.map((a) => ({
        ...a,
        unlocked: unlockedIds.has(a.id),
      }));
    },
    {
      query: t.Object({
        playerId: t.Optional(t.String()),
      }),
    },
  )

  // Get player's unlocked achievements
  .get(
    "/player/:playerId",
    async ({ params }) => {
      const db = getDb();

      const unlocked = await db
        .select({
          id: achievements.id,
          slug: achievements.slug,
          name: achievements.name,
          description: achievements.description,
          icon: achievements.icon,
          type: achievements.type,
          unlockedAt: playerAchievements.unlockedAt,
        })
        .from(playerAchievements)
        .innerJoin(
          achievements,
          eq(playerAchievements.achievementId, achievements.id),
        )
        .where(eq(playerAchievements.playerId, params.playerId));

      return unlocked;
    },
  );
