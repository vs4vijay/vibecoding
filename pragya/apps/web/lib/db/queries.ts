import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "./client";
import {
  biochemFeatures,
  cognitiveAssessments,
  cohorts,
  mciOutcomes,
  models,
  mriFeatures,
  octFeatures,
  participants,
  predictions,
  visits,
} from "./schema";

export type ParticipantFilters = {
  cohort?: string;
  sex?: "M" | "F";
  urbanRural?: "urban" | "rural";
  ageMin?: number;
  ageMax?: number;
  educationTier?: "low" | "mid" | "high";
  page?: number;
  pageSize?: number;
};

function educationWhere(tier?: "low" | "mid" | "high") {
  if (!tier) return undefined;
  if (tier === "low") return lte(participants.educationYears, 5);
  if (tier === "mid") return and(gte(participants.educationYears, 6), lte(participants.educationYears, 11));
  return gte(participants.educationYears, 12);
}

export async function listParticipants(filters: ParticipantFilters = {}) {
  const d = db();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(200, filters.pageSize ?? 50);

  const conditions = [
    filters.cohort ? eq(participants.cohortId, filters.cohort) : undefined,
    filters.sex ? eq(participants.sex, filters.sex) : undefined,
    filters.urbanRural ? eq(participants.urbanRural, filters.urbanRural) : undefined,
    filters.ageMin !== undefined ? gte(participants.ageBaseline, filters.ageMin) : undefined,
    filters.ageMax !== undefined ? lte(participants.ageBaseline, filters.ageMax) : undefined,
    educationWhere(filters.educationTier),
  ].filter((x): x is NonNullable<typeof x> => x !== undefined);

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const totalRow = await d
    .select({ count: sql<number>`count(*)::int` })
    .from(participants)
    .where(where as any);
  const total = Number(totalRow[0]?.count ?? 0);

  const rows = await d
    .select({
      id: participants.id,
      cohortId: participants.cohortId,
      ageBaseline: participants.ageBaseline,
      sex: participants.sex,
      educationYears: participants.educationYears,
      urbanRural: participants.urbanRural,
      apoe4Carrier: participants.apoe4Carrier,
    })
    .from(participants)
    .where(where as any)
    .orderBy(asc(participants.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { rows, total, page, pageSize };
}

export async function getParticipantDetail(id: string) {
  const d = db();
  const p = await d.select().from(participants).where(eq(participants.id, id)).limit(1);
  if (p.length === 0) return null;
  const participant = p[0]!;

  const visitsRows = await d
    .select()
    .from(visits)
    .where(eq(visits.participantId, id))
    .orderBy(asc(visits.visitIndex));

  const visitIds = visitsRows.map((v) => v.id);

  async function byVisit<T extends { visitId: string }>(table: any): Promise<Map<string, T>> {
    if (visitIds.length === 0) return new Map();
    const rows = (await d.select().from(table).where(sql`visit_id IN (${sql.join(visitIds.map(id => sql`${id}`), sql`, `)})`)) as T[];
    const m = new Map<string, T>();
    for (const r of rows) m.set(r.visitId, r);
    return m;
  }

  const cogMap = await byVisit<any>(cognitiveAssessments);
  const mriMap = await byVisit<any>(mriFeatures);
  const octMap = await byVisit<any>(octFeatures);
  const bioMap = await byVisit<any>(biochemFeatures);

  const detailedVisits = visitsRows.map((v) => ({
    ...v,
    cognitive: cogMap.get(v.id) ?? null,
    mri: mriMap.get(v.id) ?? null,
    oct: octMap.get(v.id) ?? null,
    biochem: bioMap.get(v.id) ?? null,
  }));

  const outcome = await d
    .select()
    .from(mciOutcomes)
    .where(eq(mciOutcomes.participantId, id))
    .limit(1);

  const preds = await d
    .select({
      id: predictions.id,
      modelId: predictions.modelId,
      horizonYears: predictions.horizonYears,
      riskPoint: predictions.riskPoint,
      riskLo80: predictions.riskLo80,
      riskHi80: predictions.riskHi80,
      riskLo95: predictions.riskLo95,
      riskHi95: predictions.riskHi95,
      madeAt: predictions.madeAt,
      modelName: models.name,
      modelVersion: models.version,
    })
    .from(predictions)
    .leftJoin(models, eq(models.id, predictions.modelId))
    .where(eq(predictions.participantId, id))
    .orderBy(desc(predictions.madeAt))
    .limit(50);

  return {
    participant,
    visits: detailedVisits,
    outcome: outcome[0] ?? null,
    predictions: preds,
  };
}

export async function listCohorts() {
  const d = db();
  return d.select().from(cohorts).orderBy(asc(cohorts.id));
}
