import { NextResponse } from "next/server";
import { importFromObject } from "../../../../scripts/import-cohort";
import { ensureSchema } from "@/lib/db/bootstrap";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await ensureSchema();
  let payload: any;
  try {
    payload = await req.json();
  } catch (e) {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  try {
    const counts = await importFromObject(payload);
    return NextResponse.json({ ok: true, counts });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
