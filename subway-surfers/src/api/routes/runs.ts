import { Elysia, t } from "elysia";
import { getDb } from "../../db/database.ts";
import { runs, players, jobs } from "../../db/schema.ts";
import { eq, desc, and } from "drizzle-orm";

export const runsRouter = new Elysia({ prefix: "/api/runs" })
  // Save a completed run
  .post(
    "/",
    async ({ body }) => {
      const db = getDb();
      const {
        playerId,
        score,
        distance,
        coinsCollected,
        multiplier,
        obstaclesDodged,
        powerupsUsed,
        maxCombo,
        playTimeSeconds,
      } = body;

      // Insert the run
      const [newRun] = await db
        .insert(runs)
        .values({
          playerId,
          score,
          distance,
          coinsCollected,
          multiplier,
          obstaclesDodged,
          powerupsUsed,
          maxCombo,
          playTimeSeconds,
        })
        .returning();

      // Queue a job to update player stats & check achievements
      await db.insert(jobs).values({
        type: "process_run",
        payload: JSON.stringify({
          runId: newRun.id,
          playerId,
          score,
          distance,
          coinsCollected,
        }),
      });

      // Notify workers
      await db.execute(
        `NOTIFY job_queue, 'process_run'`,
      );

      return newRun;
    },
    {
      body: t.Object({
        playerId: t.String(),
        score: t.Integer(),
        distance: t.Number(),
        coinsCollected: t.Integer(),
        multiplier: t.Integer(),
        obstaclesDodged: t.Integer(),
        powerupsUsed: t.Integer(),
        maxCombo: t.Integer(),
        playTimeSeconds: t.Number(),
      }),
    },
  )

  // Get player's recent runs
  .get(
    "/player/:playerId",
    async ({ params, query }) => {
      const db = getDb();
      const { limit, offset } = query;

      const result = await db
        .select()
        .from(runs)
        .where(eq(runs.playerId, params.playerId))
        .orderBy(desc(runs.playedAt))
        .limit(limit)
        .offset(offset);

      return result;
    },
    {
      query: t.Object({
        limit: t.Optional(t.Integer()),
        offset: t.Optional(t.Integer()),
      }),
    },
  );
