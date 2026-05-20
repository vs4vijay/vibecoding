import { NextResponse } from "next/server";
import { mlClient } from "@/lib/api-client/ml";
import { ensureSchema } from "@/lib/db/bootstrap";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSchema();
  let ml: { status: string; version?: string; error?: string };
  try {
    const h = await mlClient().health();
    ml = { status: h.status, version: h.version };
  } catch (e) {
    ml = { status: "error", error: (e as Error).message };
  }
  return NextResponse.json({ web: "ok", ml });
}
