import { NextResponse } from "next/server";
import { checkInternalAuth } from "@/lib/internal-auth";
import { ensureSchema } from "@/lib/db/bootstrap";
import { dequeueNext, reclaimStaleJobs } from "@/lib/queue/dequeue";
import { getConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = checkInternalAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 401 });
  await ensureSchema();
  const cfg = getConfig();
  const body = (await req.json().catch(() => ({}))) as { worker_id?: string };
  const workerId = body.worker_id ?? "unknown";
  await reclaimStaleJobs(60_000);
  const job = await dequeueNext(workerId);
  return NextResponse.json({ job });
}
