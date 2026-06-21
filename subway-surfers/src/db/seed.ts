/**
 * Seed script - runs achievement definitions into the database.
 * Run with: bun src/db/seed.ts
 */
import { getDb } from "./database.ts";
import { achievements } from "./schema.ts";

const DEFAULT_ACHIEVEMENTS = [
  {
    slug: "first_run",
    name: "First Steps",
    description: "Complete your first run",
    icon: "🏃",
    type: "distance" as const,
    requirementDistance: 1,
  },
  {
    slug: "runner_100",
    name: "Getting Started",
    description: "Run 100 meters in a single run",
    icon: "🏃‍♂️",
    type: "distance" as const,
    requirementDistance: 100,
  },
  {
    slug: "runner_500",
    name: "Sprinter",
    description: "Run 500 meters in a single run",
    icon: "⚡",
    type: "distance" as const,
    requirementDistance: 500,
  },
  {
    slug: "runner_1000",
    name: "Marathoner",
    description: "Run 1000 meters in a single run",
    icon: "🏅",
    type: "distance" as const,
    requirementDistance: 1000,
  },
  {
    slug: "runner_5000",
    name: "Ultra Runner",
    description: "Run 5000 meters in a single run",
    icon: "🏆",
    type: "distance" as const,
    requirementDistance: 5000,
  },
  {
    slug: "coin_collector_50",
    name: "Penny Picker",
    description: "Collect 50 coins in a single run",
    icon: "🪙",
    type: "coins" as const,
    requirementCoins: 50,
  },
  {
    slug: "coin_collector_200",
    name: "Coin Magnet",
    description: "Collect 200 coins in a single run",
    icon: "💰",
    type: "coins" as const,
    requirementCoins: 200,
  },
  {
    slug: "coin_collector_1000",
    name: "Gold Rush",
    description: "Collect 1000 coins in a single run",
    icon: "🤑",
    type: "coins" as const,
    requirementCoins: 1000,
  },
  {
    slug: "score_500",
    name: "Point Starter",
    description: "Score 500 points in a single run",
    icon: "⭐",
    type: "score" as const,
    requirementScore: 500,
  },
  {
    slug: "score_2500",
    name: "High Flyer",
    description: "Score 2,500 points in a single run",
    icon: "🌟",
    type: "score" as const,
    requirementScore: 2500,
  },
  {
    slug: "score_10000",
    name: "Legendary",
    description: "Score 10,000 points in a single run",
    icon: "👑",
    type: "score" as const,
    requirementScore: 10000,
  },
  {
    slug: "combo_5",
    name: "Combo Starter",
    description: "Hit a 5x combo",
    icon: "🔥",
    type: "combo" as const,
    requirementCombo: 5,
  },
  {
    slug: "combo_10",
    name: "Combo Master",
    description: "Hit a 10x combo",
    icon: "💥",
    type: "combo" as const,
    requirementCombo: 10,
  },
  {
    slug: "combo_25",
    name: "Unstoppable",
    description: "Hit a 25x combo",
    icon: "🌈",
    type: "combo" as const,
    requirementCombo: 25,
  },
  {
    slug: "powerup_10",
    name: "Power User",
    description: "Use 10 power-ups in a single run",
    icon: "🚀",
    type: "powerup" as const,
    requirementPowerups: 10,
  },
  {
    slug: "powerup_50",
    name: "Power House",
    description: "Use 50 power-ups in a single run",
    icon: "⚡",
    type: "powerup" as const,
    requirementPowerups: 50,
  },
];

async function seed() {
  const db = getDb();

  console.log("🌱 Seeding achievements...");

  for (const a of DEFAULT_ACHIEVEMENTS) {
    await db
      .insert(achievements)
      .values({
        slug: a.slug,
        name: a.name,
        description: a.description,
        icon: a.icon,
        type: a.type,
        requirementDistance: a.requirementDistance ?? null,
        requirementCoins: a.requirementCoins ?? null,
        requirementScore: a.requirementScore ?? null,
        requirementCombo: a.requirementCombo ?? null,
        requirementPowerups: a.requirementPowerups ?? null,
      })
      .onConflictDoNothing();
  }

  console.log(`✅ Seeded ${DEFAULT_ACHIEVEMENTS.length} achievements.`);
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
