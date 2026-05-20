import { NextResponse } from "next/server";
import { checkInternalAuth } from "@/lib/internal-auth";
import { ensureSchema } from "@/lib/db/bootstrap";
import { markJobOutcome } from "@/lib/queue/dequeue";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = checkInternalAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 401 });
  await ensureSchema();
  const { id } = await params;
  const body = (await req.json()) as {
    status: "succeeded" | "failed";
    result?: Record<string, unknown>;
    error?: string;
    worker_id?: string;
  };
  const r = await markJobOutcome(id, body, body.worker_id ?? "unknown");
  return NextResponse.json({ ok: true, ...r });
}
