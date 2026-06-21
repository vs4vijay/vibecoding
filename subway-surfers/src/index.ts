import { Elysia } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import { sql } from "drizzle-orm";
import { config } from "./config/env.ts";
import { getDb } from "./db/database.ts";
import { playersRouter } from "./api/routes/players.ts";
import { runsRouter } from "./api/routes/runs.ts";
import { leaderboardRouter } from "./api/routes/leaderboard.ts";
import { achievementsRouter } from "./api/routes/achievements.ts";

const app = new Elysia()
  // Serve static client files from dist/
  .use(
    staticPlugin({
      prefix: "/",
      assets: "./dist",
      ignoreFiles: ["tsconfig.json", "*.map"],
      cache: "immutable",
    }),
  )

  // Register API routes
  .use(playersRouter)
  .use(runsRouter)
  .use(leaderboardRouter)
  .use(achievementsRouter)

  // Health check
  .get("/api/health", () => ({
    status: "ok",
    environment: config.nodeEnv,
    timestamp: new Date().toISOString(),
  }))

  // PWA manifest
  .get("/manifest.json", () => ({
    name: config.appName,
    short_name: "SubwaySurfers",
    description: "A Subway Surfers clone - 3D endless runner",
    start_url: "/",
    display: "fullscreen",
    background_color: "#1a1a2e",
    theme_color: "#16213e",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any maskable",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any maskable",
      },
    ],
  }))

  // SPA fallback: serve index.html for non-API routes
  .onError(({ code, error, code: statusCode }) => {
    if (code === "NOT_FOUND") {
      const url = new URL(error.request?.url || "");
      if (!url.pathname.startsWith("/api/")) {
        try {
          const content = Bun.file("./dist/index.html").textSync();
          return new Response(content, {
            status: 200,
            headers: { "Content-Type": "text/html" },
          });
        } catch {
          // fall through
        }
      }
    }
    return null;
  })

  .onStart(async () => {
    console.log("\n🏃 Subway Surfers Clone");
    console.log("   Server: http://" + config.host + ":" + config.port);
    console.log("   Environment: " + config.nodeEnv);
    const maskedUrl =
      config.databaseUrl.split("@")[0] +
      "://***@" +
      config.databaseUrl.split("@")[1];
    console.log("   Database: " + maskedUrl);
    console.log("");

    // Test database connection
    try {
      const db = getDb();
      await db.execute(sql`SELECT 1`);
      console.log("   ✅ Database connected");
    } catch (err) {
      console.error("   ❌ Database connection failed:", err);
      console.log(
        "   💡 Make sure PostgreSQL is running and DATABASE_URL is correct",
      );
    }
    console.log("");
  });

app.listen(config.port);

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n👋 Shutting down...");
  process.exit(0);
});

export default app;
