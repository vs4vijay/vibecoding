import { NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db/bootstrap";
import { getParticipantDetail } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await ensureSchema();
  const { id } = await params;
  const detail = await getParticipantDetail(id);
  if (!detail) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(detail);
}
