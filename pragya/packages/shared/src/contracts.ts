import { z } from "zod";

export const HealthResponse = z.object({
  status: z.literal("ok"),
  service: z.string(),
  version: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const PredictRequest = z.object({
  participant_id: z.string(),
  model_id: z.string().optional(),
  horizons_years: z.array(z.number().int().positive()).default([1, 3, 5]),
  features: z.record(z.string(), z.unknown()),
  seed: z.number().int().optional(),
});
export type PredictRequest = z.infer<typeof PredictRequest>;

export const RiskInterval = z.object({
  horizon_years: z.number().int().positive(),
  risk_point: z.number().min(0).max(1),
  risk_lo_80: z.number().min(0).max(1),
  risk_hi_80: z.number().min(0).max(1),
  risk_lo_95: z.number().min(0).max(1),
  risk_hi_95: z.number().min(0).max(1),
});
export type RiskInterval = z.infer<typeof RiskInterval>;

export const PredictResponse = z.object({
  participant_id: z.string(),
  model_id: z.string(),
  model_version: z.string(),
  predictions: z.array(RiskInterval),
});
export type PredictResponse = z.infer<typeof PredictResponse>;

export const HarmoniseRequest = z.object({
  cohort_ids: z.array(z.string()).min(2),
  modalities: z.array(z.enum(["mri", "biochem", "oct", "cognitive"])).default(["mri", "biochem"]),
  seed: z.number().int().optional(),
});
export type HarmoniseRequest = z.infer<typeof HarmoniseRequest>;

export const HarmoniseResponse = z.object({
  run_id: z.string(),
  cohort_ids: z.array(z.string()),
  feature_count: z.number().int().nonnegative(),
  before_means: z.record(z.string(), z.record(z.string(), z.number())),
  after_means: z.record(z.string(), z.record(z.string(), z.number())),
  parameters: z.record(z.string(), z.unknown()),
});
export type HarmoniseResponse = z.infer<typeof HarmoniseResponse>;

export const TrainRequest = z.object({
  cohort_ids: z.array(z.string()).min(1),
  modalities: z.array(z.enum(["mri", "biochem", "oct", "cognitive"])).default(["mri", "biochem", "cognitive"]),
  horizons_years: z.array(z.number().int().positive()).default([1, 3, 5]),
  ensemble_size: z.number().int().positive().default(3),
  seed: z.number().int().default(42),
  harmonisation_run_id: z.string().optional(),
});
export type TrainRequest = z.infer<typeof TrainRequest>;

export const TrainResponse = z.object({
  model_id: z.string(),
  model_version: z.string(),
  metrics: z.object({
    auroc: z.record(z.string(), z.number()),
    auprc: z.record(z.string(), z.number()),
    brier: z.record(z.string(), z.number()),
    calibration_error: z.record(z.string(), z.number()),
  }),
  params: z.record(z.string(), z.unknown()),
  ensemble_size: z.number().int().positive(),
});
export type TrainResponse = z.infer<typeof TrainResponse>;

export const AuditRequest = z.object({
  model_id: z.string(),
  cohort_ids: z.array(z.string()).optional(),
  seed: z.number().int().optional(),
});
export type AuditRequest = z.infer<typeof AuditRequest>;

export const SubgroupMetric = z.object({
  subgroup: z.string(),
  value: z.string(),
  n: z.number().int(),
  auroc: z.record(z.string(), z.number()),
  auprc: z.record(z.string(), z.number()),
  calibration_error: z.record(z.string(), z.number()),
});
export type SubgroupMetric = z.infer<typeof SubgroupMetric>;

export const AuditResponse = z.object({
  model_id: z.string(),
  calibration: z.record(
    z.string(),
    z.array(z.object({ predicted: z.number(), observed: z.number(), n: z.number().int() })),
  ),
  subgroups: z.array(SubgroupMetric),
});
export type AuditResponse = z.infer<typeof AuditResponse>;

export const JobKind = z.enum([
  "noop",
  "predict",
  "harmonise",
  "train",
  "audit",
]);
export type JobKind = z.infer<typeof JobKind>;

export const JobStatus = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
]);
export type JobStatus = z.infer<typeof JobStatus>;
