import { NextRequest, NextResponse } from "next/server";
import { SourceCreateSchema } from "@/lib/validation";
import { fetchOnePage, type HttpConfig, type PaginationConfig } from "@/lib/pipeline/fetch";
import { extractScalar } from "@/lib/pipeline/extract";
import { canonicalHash } from "@/lib/pipeline/hash";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = SourceCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid config", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const v = parsed.data;
  try {
    const { raw, records } = await fetchOnePage(
      v.http as HttpConfig,
      v.records_path,
      v.pagination as PaginationConfig
    );
    const preview = records.slice(0, 5).map((rec) => ({
      external_id: extractScalar(rec, v.external_id_path),
      hash: canonicalHash(rec, v.hash_fields ?? null),
      record: rec,
    }));
    return NextResponse.json({
      ok: true,
      count: records.length,
      external_id_path: v.external_id_path,
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
