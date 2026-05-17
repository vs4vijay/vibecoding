import { NextRequest, NextResponse } from "next/server";
import { searchEntities } from "@/lib/search";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ error: "missing q" }, { status: 400 });
  const limit = parseInt(url.searchParams.get("limit") ?? "50", 10) || 50;
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10) || 0;
  const source = url.searchParams.get("source") ?? undefined;
  const category = url.searchParams.get("category") ?? undefined;
  const rollupParam = url.searchParams.get("cluster_rollup");
  const cluster_rollup = rollupParam == null ? undefined : rollupParam === "true" || rollupParam === "1";
  const result = await searchEntities({ q, limit, offset, source, category, cluster_rollup });
  return NextResponse.json({ q, total: result.hits.length, ...result });
}
