import type { Handler } from "./index";

export const auditHandler: Handler = async (job, ctx) => {
  const modelId = job.payload.model_id as string;
  const seed = (job.payload.seed as number | undefined) ?? undefined;
  const cohortIds = (job.payload.cohort_ids as string[] | undefined) ?? undefined;

  // Get the training matrix (model auditing needs the same row shape).
  const matrix = (await ctx.web.getTrainingMatrix({
    cohort_ids: cohortIds ?? [],
    modalities: ["mri", "biochem", "cognitive"],
  })) as { rows: Array<Record<string, unknown>> };

  const audit = (await ctx.ml.audit({
    model_id: modelId,
    cohort_ids: cohortIds,
    seed,
    rows: matrix.rows,
  })) as {
    model_id: string;
    calibration: Record<string, Array<{ predicted: number; observed: number; n: number }>>;
    subgroups: Array<{
      subgroup: string;
      value: string;
      n: number;
      auroc: Record<string, number>;
      auprc: Record<string, number>;
      calibration_error: Record<string, number>;
    }>;
  };

  const persisted = (await ctx.web.writeAudit({
    model_id: audit.model_id,
    calibration: audit.calibration,
    subgroups: audit.subgroups,
  })) as { id: string };

  return {
    status: "succeeded",
    result: { audit_id: persisted.id, model_id: audit.model_id, subgroup_count: audit.subgroups.length },
  };
};
