import { NextRequest, NextResponse } from "next/server";
import { listEntities } from "@/lib/entities-query";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const sourceName = url.searchParams.get("source") ?? undefined;
  const limit = parseInt(url.searchParams.get("limit") ?? "50", 10) || 50;
  const entities = await listEntities({ sourceName, limit });
  return NextResponse.json({ entities });
}
