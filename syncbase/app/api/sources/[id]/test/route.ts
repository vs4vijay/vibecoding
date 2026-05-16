import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { sources } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { fetchOnePage, type HttpConfig, type PaginationConfig } from "@/lib/pipeline/fetch";
import { extractScalar } from "@/lib/pipeline/extract";
import { canonicalHash } from "@/lib/pipeline/hash";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const rows = await db.select().from(sources).where(eq(sources.id, Number(id)));
  if (rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const src = rows[0];

  try {
    const { raw, records } = await fetchOnePage(
      src.http as HttpConfig,
      src.recordsPath,
      src.pagination as PaginationConfig
    );

    const preview = records.slice(0, 5).map((rec) => ({
      external_id: extractScalar(rec, src.externalIdPath),
      hash: canonicalHash(rec, src.hashFields ?? null),
      record: rec,
    }));

    return NextResponse.json({
      ok: true,
      count: records.length,
      external_id_path: src.externalIdPath,
      preview,
      raw_sample: truncate(raw),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 502 }
    );
  }
}

function truncate(v: unknown): unknown {
  const s = JSON.stringify(v);
  if (s.length <= 2000) return v;
  return s.slice(0, 2000) + "...[truncated]";
}
