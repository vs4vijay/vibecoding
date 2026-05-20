import type { Handler } from "./index";

export const harmoniseHandler: Handler = async (job, ctx) => {
  const cohortIds = job.payload.cohort_ids as string[];
  const modalities = (job.payload.modalities as string[]) ?? ["mri", "biochem"];
  const seed = (job.payload.seed as number | undefined) ?? undefined;

  const matrix = (await ctx.web.getCohortFeatureMatrix({
    cohort_ids: cohortIds,
    modalities,
  })) as {
    rows: Array<{ visit_id: string; cohort_id: string; features: Record<string, Record<string, number>> }>;
  };

  const mlResult = (await ctx.ml.harmonise({
    cohort_ids: cohortIds,
    modalities,
    seed,
    rows: matrix.rows,
  })) as {
    run_id: string;
    cohort_ids: string[];
    feature_count: number;
    before_means: Record<string, Record<string, number>>;
    after_means: Record<string, Record<string, number>>;
    parameters: Record<string, unknown>;
    harmonised_rows: Array<{ visit_id: string; modality: string; payload: Record<string, number> }>;
  };

  const persisted = (await ctx.web.writeHarmonisationRun({
    cohort_ids: mlResult.cohort_ids,
    modalities,
    params: mlResult.parameters,
    before_means: mlResult.before_means,
    after_means: mlResult.after_means,
    harmonised_rows: mlResult.harmonised_rows,
  })) as { run_id: string };

  return {
    status: "succeeded",
    result: {
      run_id: persisted.run_id,
      cohort_ids: mlResult.cohort_ids,
      feature_count: mlResult.feature_count,
    },
  };
};
