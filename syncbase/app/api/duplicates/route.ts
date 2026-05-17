import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { sql } from "drizzle-orm";
import { listIntraSourcePairs, listClusters } from "@/lib/duplicates-query";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "100", 10) || 100;
  const source = url.searchParams.get("source") ?? undefined;
  const [pairs, clusters] = await Promise.all([
    listIntraSourcePairs({ limit, source }),
    listClusters({ limit }),
  ]);
  return NextResponse.json({ pairs, clusters });
}

const OverrideSchema = z.object({
  source: z.string().min(1),
  entity_a_id: z.number().int().positive(),
  entity_b_id: z.number().int().positive(),
  decision: z.enum(["same", "different"]),
  decided_by: z.string().min(1).default("ui"),
});

/** POST /api/duplicates — write an override row.
 *  Body: { source, entity_a_id, entity_b_id, decision: 'same'|'different', decided_by? }
 *  Effect: also removes the pair from entity_duplicates so the UI doesn't keep re-suggesting it
 *          when decision==='different'. When decision==='same', flips the existing row to status='confirmed'. */
export async function POST(req: NextRequest) {
  const ct = req.headers.get("content-type") ?? "";
  let raw: any;
  if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
    const fd = await req.formData();
    raw = {
      source: fd.get("source"),
      entity_a_id: Number(fd.get("entity_a_id")),
      entity_b_id: Number(fd.get("entity_b_id")),
      decision: fd.get("decision"),
      decided_by: fd.get("decided_by") ?? "ui",
    };
  } else {
    raw = await req.json();
  }
  const parsed = OverrideSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid override", issues: parsed.error.issues }, { status: 400 });
  }
  const { source, entity_a_id, entity_b_id, decision, decided_by } = parsed.data;
  const db = getDb();
  await db.execute(sql`
    INSERT INTO entity_duplicate_overrides (source, entity_a_id, entity_b_id, decision, decided_by)
    VALUES (${source}, ${entity_a_id}, ${entity_b_id}, ${decision}, ${decided_by})
    ON CONFLICT (source, entity_a_id, entity_b_id) DO UPDATE
      SET decision = EXCLUDED.decision,
          decided_by = EXCLUDED.decided_by,
          decided_at = now()
  `);
  if (decision === "different") {
    await db.execute(sql`
      DELETE FROM entity_duplicates
      WHERE source = ${source}
        AND ((canonical_id = ${entity_a_id} AND duplicate_id = ${entity_b_id})
          OR (canonical_id = ${entity_b_id} AND duplicate_id = ${entity_a_id}))
    `);
  } else {
    await db.execute(sql`
      UPDATE entity_duplicates SET status='confirmed'
      WHERE source = ${source}
        AND ((canonical_id = ${entity_a_id} AND duplicate_id = ${entity_b_id})
          OR (canonical_id = ${entity_b_id} AND duplicate_id = ${entity_a_id}))
    `);
  }
  // Form submissions: redirect back to /duplicates so the operator sees the table refresh.
  if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
    const back = new URL("/duplicates", req.url);
    return NextResponse.redirect(back, 303);
  }
  return NextResponse.json({ ok: true });
}
