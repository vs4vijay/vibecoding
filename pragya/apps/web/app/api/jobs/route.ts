import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { jobs } from "@/lib/db/schema";
import { enqueueJob } from "@/lib/queue/enqueue";
import { ensureSchema } from "@/lib/db/bootstrap";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await ensureSchema();
  const url = new URL(req.url);
  const limit = Math.min(200, Number(url.searchParams.get("limit") ?? 50));
  const d = db();
  const rows = await d.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(limit);
  return NextResponse.json({ jobs: rows });
}

export async function POST(req: Request) {
  await ensureSchema();
  const body = (await req.json()) as { kind: string; payload?: Record<string, unknown> };
  if (!body.kind) return NextResponse.json({ error: "kind required" }, { status: 400 });
  const { id } = await enqueueJob({ kind: body.kind, payload: body.payload ?? {} });
  return NextResponse.json({ id }, { status: 201 });
}
