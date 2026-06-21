import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { config } from "./config/env.ts";
import * as schema from "./db/schema.ts";
import { jobs, players, achievements, playerAchievements } from "./db/schema.ts";
import { eq, asc, and, sql } from "drizzle-orm";

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 5,
});

const db = drizzle(pool, { schema });

/**
 * Worker process that listens for job notifications and processes them
 * using Postgres LISTEN/NOTIFY with SKIP LOCKED for concurrent safety.
 */

async function processJob(job: typeof jobs.$inferSelect): Promise<void> {
  const payload = JSON.parse(job.payload);

  switch (job.type) {
    case "process_run": {
      await processRun(payload);
      break;
    }
    default:
      console.warn(`Unknown job type: ${job.type}`);
  }
}

async function processRun(payload: {
  runId: string;
  playerId: string;
  score: number;
  distance: number;
  coinsCollected: number;
}): Promise<void> {
  const { runId, playerId, score, distance, coinsCollected } = payload;

  // Update player stats
  await db
    .update(players)
    .set({
      totalDistance: sql`${players.totalDistance} + ${Math.floor(distance)}`,
      totalCoins: sql`${players.totalCoins} + ${coinsCollected}`,
      highScore: sql`GREATEST(${players.highScore}, ${score})`,
      gamesPlayed: sql`${players.gamesPlayed} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(players.id, playerId));

  console.log(`  ✅ Updated player stats for ${playerId}`);

  // Check achievements
  await checkAchievements(playerId, { score, distance, coinsCollected });
}

async function checkAchievements(
  playerId: string,
  stats: { score: number; distance: number; coinsCollected: number },
): Promise<void> {
  const allAchievements = await db.select().from(achievements);
  const alreadyUnlocked = await db
    .select({ achievementId: playerAchievements.achievementId })
    .from(playerAchievements)
    .where(eq(playerAchievements.playerId, playerId))
    .then((rows) => new Set(rows.map((r) => r.achievementId)));

  let newUnlocks = 0;

  for (const achievement of allAchievements) {
    if (alreadyUnlocked.has(achievement.id)) continue;

    let unlocked = false;

    switch (achievement.type) {
      case "distance":
        if (
          achievement.requirementDistance &&
          stats.distance >= achievement.requirementDistance
        ) {
          unlocked = true;
        }
        break;
      case "coins":
        if (
          achievement.requirementCoins &&
          stats.coinsCollected >= achievement.requirementCoins
        ) {
          unlocked = true;
        }
        break;
      case "score":
        if (
          achievement.requirementScore &&
          stats.score >= achievement.requirementScore
        ) {
          unlocked = true;
        }
        break;
      case "combo":
        // Would need maxCombo from run data
        break;
      case "powerup":
        // Would need powerupsUsed from run data
        break;
    }

    if (unlocked) {
      await db.insert(playerAchievements).values({
        playerId,
        achievementId: achievement.id,
      });
      newUnlocks++;
      alreadyUnlocked.add(achievement.id);
      console.log(`  🏆 Achievement unlocked: ${achievement.name}`);
    }
  }

  if (newUnlocks > 0) {
    console.log(`  🎉 ${newUnlocks} new achievement(s) unlocked!`);
  }
}

/**
 * Fetch and lock a pending job using SKIP LOCKED for concurrent worker safety.
 */
async function fetchNextJob(): Promise<
  typeof jobs.$inferSelect | null
> {
  const result = await db.execute(sql`
    UPDATE jobs
    SET status = 'processing',
        started_at = NOW(),
        attempts = attempts + 1
    WHERE id = (
      SELECT id FROM jobs
      WHERE status = 'pending'
        AND attempts < max_attempts
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `);

  return result.length > 0 ? (result[0] as typeof jobs.$inferSelect) : null;
}

async function completeJob(jobId: string): Promise<void> {
  await db
    .update(jobs)
    .set({
      status: "completed",
      completedAt: new Date(),
    })
    .where(eq(jobs.id, jobId));
}

async function failJob(
  jobId: string,
  errorMessage: string,
): Promise<void> {
  const job = await db
    .select()
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1)
    .then((rows) => rows[0]);

  if (job && job.attempts >= job.maxAttempts) {
    await db
      .update(jobs)
      .set({
        status: "failed",
        errorMessage,
        completedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));
  } else {
    await db
      .update(jobs)
      .set({
        status: "pending",
        errorMessage,
      })
      .where(eq(jobs.id, jobId));
  }
}

/**
 * Main worker loop: LISTEN for notifications, poll for jobs.
 */
async function run(): Promise<void> {
  console.log(`\n🔄 Worker started`);
  console.log(`   Poll interval: ${config.workerPollIntervalMs}ms`);
  console.log("");

  // Listen for job notifications
  const client = await pool.connect();
  await client.query("LISTEN job_queue");

  client.on("notification", async (notification) => {
    console.log(
      `📬 Notification: channel=${notification.channel}, payload=${notification.payload}`,
    );
    await processPendingJobs();
  });

  // Also poll periodically (belt and suspenders)
  const pollInterval = setInterval(async () => {
    await processPendingJobs();
  }, config.workerPollIntervalMs);

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\n👋 Worker shutting down...");
    clearInterval(pollInterval);
    await client.release(true);
    await pool.end();
    process.exit(0);
  });

  console.log("👂 Listening for job notifications...\n");
}

async function processPendingJobs(): Promise<void> {
  const job = await fetchNextJob();
  if (!job) return;

  console.log(`⚙️ Processing job: ${job.id} (${job.type})`);

  try {
    await processJob(job);
    await completeJob(job.id);
    console.log(`✅ Job completed: ${job.id}`);
  } catch (err) {
    console.error(`❌ Job failed: ${job.id}`, err);
    await failJob(job.id, String(err));
  }
}

// Start worker
run().catch((err) => {
  console.error("❌ Worker crashed:", err);
  process.exit(1);
});
