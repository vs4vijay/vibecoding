import { NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db/bootstrap";
import { listParticipants } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await ensureSchema();
  const url = new URL(req.url);
  const result = await listParticipants({
    cohort: url.searchParams.get("cohort") ?? undefined,
    sex: (url.searchParams.get("sex") as "M" | "F") ?? undefined,
    urbanRural: (url.searchParams.get("urban_rural") as "urban" | "rural") ?? undefined,
    educationTier: (url.searchParams.get("education") as any) ?? undefined,
    ageMin: url.searchParams.get("age_min") ? Number(url.searchParams.get("age_min")) : undefined,
    ageMax: url.searchParams.get("age_max") ? Number(url.searchParams.get("age_max")) : undefined,
    page: url.searchParams.get("page") ? Number(url.searchParams.get("page")) : 1,
    pageSize: url.searchParams.get("page_size") ? Number(url.searchParams.get("page_size")) : 50,
  });
  return NextResponse.json(result);
}
