import type { Handler } from "./index";

export const predictHandler: Handler = async (job, ctx) => {
  const participantId = String(job.payload.participant_id);
  const horizons = (job.payload.horizons_years as number[]) ?? [1, 3, 5];
  const seed = (job.payload.seed as number | undefined) ?? undefined;

  const features = await ctx.web.getParticipantFeatures(participantId);
  const modelId = (job.payload.model_id as string | undefined) ?? undefined;

  const result = (await ctx.ml.predict({
    participant_id: participantId,
    model_id: modelId,
    horizons_years: horizons,
    features: features.features,
    seed,
  })) as {
    model_id: string;
    model_version: string;
    predictions: Array<{
      horizon_years: number;
      risk_point: number;
      risk_lo_80: number;
      risk_hi_80: number;
      risk_lo_95: number;
      risk_hi_95: number;
    }>;
  };

  await ctx.web.writePrediction({
    participant_id: participantId,
    model_id: result.model_id,
    predictions: result.predictions,
    input_snapshot: features.features,
  });

  return {
    status: "succeeded",
    result: {
      model_id: result.model_id,
      model_version: result.model_version,
      horizons: result.predictions.map((p) => p.horizon_years),
    },
  };
};
