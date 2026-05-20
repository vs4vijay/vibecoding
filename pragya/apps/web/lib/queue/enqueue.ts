import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, getDb } from "../db/client";
import { jobs } from "../db/schema";

export type EnqueueInput = {
  kind: string;
  payload?: Record<string, unknown>;
  runAfter?: Date;
  maxAttempts?: number;
};

export async function enqueueJob(input: EnqueueInput): Promise<{ id: string }> {
  const id = `job-${randomUUID()}`;
  const d = db();
  await d.insert(jobs).values({
    id,
    kind: input.kind,
    payload: input.payload ?? {},
    runAfter: input.runAfter ?? new Date(),
    maxAttempts: input.maxAttempts ?? 3,
  });
  // Notify; on PGLite the notify is best-effort, the worker also polls.
  try {
    await d.execute(sql`SELECT pg_notify('jobs:new', ${id})`);
  } catch {
    // PGLite or no listener — fine, the worker polls.
  }
  return { id };
}
