import { Cron } from "croner";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import type { Scheduler } from "./index";

// In-process croner for PGLite. On each tick we NOTIFY run_due — same downstream
// behavior as PgCronScheduler, so bin/worker.ts handles both identically.
export class CronerScheduler implements Scheduler {
  private jobs = new Map<string, { cron: string; job: Cron }>();

  async register(name: string, cron: string): Promise<void> {
    await this.unregister(name);
    const job = new Cron(cron, async () => {
      const db = getDb();
      await db.execute(
        sql`SELECT pg_notify('run_due', ${name})`
      );
    });
    this.jobs.set(name, { cron, job });
  }

  async unregister(name: string): Promise<void> {
    const existing = this.jobs.get(name);
    if (existing) {
      existing.job.stop();
      this.jobs.delete(name);
    }
  }

  async list(): Promise<{ name: string; cron: string }[]> {
    return Array.from(this.jobs.entries()).map(([name, { cron }]) => ({ name, cron }));
  }
}
