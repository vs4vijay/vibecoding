import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/client";
import { audits } from "@/lib/db/schema";
import { ensureSchema } from "@/lib/db/bootstrap";
import { checkInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

type Body = {
  model_id: string;
  calibration: Record<string, Array<{ predicted: number; observed: number; n: number }>>;
  subgroups: Array<{
    subgroup: string;
    value: string;
    n: number;
    auroc: Record<string, number>;
    auprc: Record<string, number>;
    calibration_error: Record<string, number>;
  }>;
};

export async function POST(req: Request) {
  const auth = checkInternalAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 401 });
  await ensureSchema();
  const body = (await req.json()) as Body;
  const d = db();
  const id = `audit-${randomUUID()}`;
  await d.insert(audits).values({
    id,
    modelId: body.model_id,
    calibration: body.calibration,
    subgroups: body.subgroups,
  });
  return NextResponse.json({ id });
}
