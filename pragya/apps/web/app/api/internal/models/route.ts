import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { models } from "@/lib/db/schema";
import { ensureSchema } from "@/lib/db/bootstrap";
import { checkInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

type Body = {
  id: string;
  name: string;
  version: string;
  params: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  artefact_url?: string | null;
  activate?: boolean;
};

export async function POST(req: Request) {
  const auth = checkInternalAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 401 });
  await ensureSchema();
  const body = (await req.json()) as Body;
  const d = db();

  if (body.activate) {
    await d.execute(sql`UPDATE models SET is_active = false`);
  }
  await d
    .insert(models)
    .values({
      id: body.id,
      name: body.name,
      version: body.version,
      params: body.params,
      metrics: body.metrics ?? null,
      artefactUrl: body.artefact_url ?? null,
      isActive: body.activate ?? false,
    })
    .onConflictDoNothing();

  return NextResponse.json({ id: body.id });
}
