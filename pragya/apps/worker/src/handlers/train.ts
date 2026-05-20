import type { Handler } from "./index";

export const trainHandler: Handler = async (job, ctx) => {
  const cohortIds = job.payload.cohort_ids as string[];
  const modalities = (job.payload.modalities as string[]) ?? ["mri", "biochem", "cognitive"];
  const horizons = (job.payload.horizons_years as number[]) ?? [1, 3, 5];
  const ensembleSize = (job.payload.ensemble_size as number | undefined) ?? 3;
  const seed = (job.payload.seed as number | undefined) ?? 42;
  const harmonisationRunId = (job.payload.harmonisation_run_id as string | undefined) ?? undefined;

  const matrix = (await ctx.web.getTrainingMatrix({
    cohort_ids: cohortIds,
    modalities,
    harmonisation_run_id: harmonisationRunId,
  })) as { rows: Array<Record<string, unknown>>; modalities: string[] };

  const trained = (await ctx.ml.train({
    cohort_ids: cohortIds,
    modalities,
    horizons_years: horizons,
    ensemble_size: ensembleSize,
    seed,
    harmonisation_run_id: harmonisationRunId,
    rows: matrix.rows,
  })) as {
    model_id: string;
    model_version: string;
    metrics: Record<string, Record<string, number>>;
    params: Record<string, unknown>;
    ensemble_size: number;
  };

  const persisted = (await ctx.web.writeModel({
    id: trained.model_id,
    name: "drishti-survival",
    version: trained.model_version,
    params: trained.params,
    metrics: trained.metrics,
    artefact_url: null,
    activate: true,
  })) as { id: string };

  return {
    status: "succeeded",
    result: {
      model_id: persisted.id,
      model_version: trained.model_version,
      metrics: trained.metrics,
    },
  };
};
