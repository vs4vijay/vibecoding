import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { models, predictions } from "@/lib/db/schema";
import { ensureSchema } from "@/lib/db/bootstrap";
import { checkInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

type Body = {
  participant_id: string;
  model_id: string;
  predictions: Array<{
    horizon_years: number;
    risk_point: number;
    risk_lo_80: number;
    risk_hi_80: number;
    risk_lo_95: number;
    risk_hi_95: number;
  }>;
  input_snapshot?: Record<string, unknown>;
};

export async function POST(req: Request) {
  const auth = checkInternalAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 401 });
  await ensureSchema();
  const body = (await req.json()) as Body;
  const d = db();

  // Ensure model row exists.
  const found = await d.select({ id: models.id }).from(models).where(eq(models.id, body.model_id)).limit(1);
  if (found.length === 0) {
    await d.insert(models).values({
      id: body.model_id,
      name: body.model_id.startsWith("stub") ? "stub" : "drishti-survival",
      version: "0.0.0",
      params: { auto: true },
    }).onConflictDoNothing();
  }

  const rows = body.predictions.map((p) => ({
    id: `pred-${randomUUID()}`,
    participantId: body.participant_id,
    modelId: body.model_id,
    horizonYears: p.horizon_years,
    riskPoint: p.risk_point,
    riskLo80: p.risk_lo_80,
    riskHi80: p.risk_hi_80,
    riskLo95: p.risk_lo_95,
    riskHi95: p.risk_hi_95,
    inputSnapshot: body.input_snapshot ?? null,
  }));
  if (rows.length > 0) await d.insert(predictions).values(rows);
  return NextResponse.json({ inserted: rows.length });
}
