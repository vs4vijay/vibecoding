import { sql } from "drizzle-orm";
import { getDb } from "../db";
import type { Scheduler } from "./index";

// Stored cron jobs run the SELECT pg_notify('run_due', '<source_name>') statement.
// A separate worker process (bin/worker.ts) LISTENs on run_due and invokes runPipeline.
export class PgCronScheduler implements Scheduler {
  async register(name: string, cron: string): Promise<void> {
    const db = getDb();
    const jobName = jobNameFor(name);
    const cmd = `SELECT pg_notify('run_due', ${quoteLiteral(name)})`;
    // Unregister first to handle update-in-place.
    await this.unregister(name);
    await db.execute(
      sql`SELECT cron.schedule(${jobName}, ${cron}, ${cmd})`
    );
  }

  async unregister(name: string): Promise<void> {
    const db = getDb();
    const jobName = jobNameFor(name);
    try {
      await db.execute(sql`SELECT cron.unschedule(${jobName})`);
    } catch {
      // job doesn't exist — ignore
    }
  }

  async list(): Promise<{ name: string; cron: string }[]> {
    const db = getDb();
    const res: any = await db.execute(
      sql`SELECT jobname, schedule FROM cron.job WHERE jobname LIKE 'statesnapper:%'`
    );
    const rows = res.rows ?? res;
    return rows.map((r: any) => ({
      name: r.jobname.replace(/^statesnapper:/, ""),
      cron: r.schedule,
    }));
  }
}

function jobNameFor(name: string): string {
  return `statesnapper:${name}`;
}

function quoteLiteral(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}
