import {
  pgTable,
  serial,
  text,
  integer,
  real,
  timestamp,
  jsonb,
  uuid,
  boolean,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";

// --- Phase 1: prove the wiring ---

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- Phase 2: participants and visits ---

export const cohorts = pgTable("cohorts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  source: text("source").notNull(), // 'SYNTH' | 'TLSA' | 'SANSCOG' | etc.
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const participants = pgTable(
  "participants",
  {
    id: text("id").primaryKey(),
    cohortId: text("cohort_id")
      .notNull()
      .references(() => cohorts.id, { onDelete: "cascade" }),
    ageBaseline: real("age_baseline").notNull(),
    sex: text("sex", { enum: ["M", "F"] }).notNull(),
    educationYears: integer("education_years").notNull(),
    urbanRural: text("urban_rural", { enum: ["urban", "rural"] }).notNull(),
    apoe4Carrier: boolean("apoe4_carrier").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    cohortIdx: index("participants_cohort_idx").on(t.cohortId),
    ageIdx: index("participants_age_idx").on(t.ageBaseline),
  }),
);

export const visits = pgTable(
  "visits",
  {
    id: text("id").primaryKey(),
    participantId: text("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    visitIndex: integer("visit_index").notNull(),
    ageAtVisit: real("age_at_visit").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    participantIdx: index("visits_participant_idx").on(t.participantId),
    uniqVisit: uniqueIndex("visits_unique_per_participant").on(t.participantId, t.visitIndex),
  }),
);

export const cognitiveAssessments = pgTable("cognitive_assessments", {
  id: text("id").primaryKey(),
  visitId: text("visit_id")
    .notNull()
    .references(() => visits.id, { onDelete: "cascade" }),
  memory: real("memory").notNull(),
  executive: real("executive").notNull(),
  language: real("language").notNull(),
  attention: real("attention").notNull(),
  visuospatial: real("visuospatial").notNull(),
  // Aggregate score for convenience.
  mmse: real("mmse").notNull(),
});

export const mriFeatures = pgTable("mri_features", {
  id: text("id").primaryKey(),
  visitId: text("visit_id")
    .notNull()
    .references(() => visits.id, { onDelete: "cascade" }),
  hippocampusL: real("hippocampus_l").notNull(),
  hippocampusR: real("hippocampus_r").notNull(),
  entorhinalL: real("entorhinal_l").notNull(),
  entorhinalR: real("entorhinal_r").notNull(),
  corticalThicknessMean: real("cortical_thickness_mean").notNull(),
  ventricularVolume: real("ventricular_volume").notNull(),
  whiteMatterHyperintensities: real("white_matter_hyperintensities").notNull(),
});

export const octFeatures = pgTable("oct_features", {
  id: text("id").primaryKey(),
  visitId: text("visit_id")
    .notNull()
    .references(() => visits.id, { onDelete: "cascade" }),
  rnflThickness: real("rnfl_thickness").notNull(),
  gccThickness: real("gcc_thickness").notNull(),
  vesselDensity: real("vessel_density").notNull(),
});

export const biochemFeatures = pgTable("biochem_features", {
  id: text("id").primaryKey(),
  visitId: text("visit_id")
    .notNull()
    .references(() => visits.id, { onDelete: "cascade" }),
  hba1c: real("hba1c").notNull(),
  ldl: real("ldl").notNull(),
  hdl: real("hdl").notNull(),
  triglycerides: real("triglycerides").notNull(),
  sbp: real("sbp").notNull(),
  dbp: real("dbp").notNull(),
  bmi: real("bmi").notNull(),
});

export const mciOutcomes = pgTable("mci_outcomes", {
  id: text("id").primaryKey(),
  participantId: text("participant_id")
    .notNull()
    .references(() => participants.id, { onDelete: "cascade" }),
  // Time in years from baseline at which MCI is observed (or right-censored).
  timeYears: real("time_years").notNull(),
  mciStatus: boolean("mci_status").notNull(), // true = converted, false = censored
});

// --- Phase 3: jobs ---

export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    status: text("status", { enum: ["queued", "running", "succeeded", "failed"] })
      .notNull()
      .default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => ({
    statusIdx: index("jobs_status_idx").on(t.status),
    runAfterIdx: index("jobs_run_after_idx").on(t.runAfter),
    kindIdx: index("jobs_kind_idx").on(t.kind),
  }),
);

// --- Phase 4-7: models, predictions, harmonisation ---

export const models = pgTable("models", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  version: text("version").notNull(),
  params: jsonb("params").notNull().$type<Record<string, unknown>>(),
  metrics: jsonb("metrics").$type<Record<string, unknown>>(),
  artefactUrl: text("artefact_url"),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const predictions = pgTable(
  "predictions",
  {
    id: text("id").primaryKey(),
    participantId: text("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    modelId: text("model_id")
      .notNull()
      .references(() => models.id),
    horizonYears: integer("horizon_years").notNull(),
    riskPoint: real("risk_point").notNull(),
    riskLo80: real("risk_lo_80").notNull(),
    riskHi80: real("risk_hi_80").notNull(),
    riskLo95: real("risk_lo_95").notNull(),
    riskHi95: real("risk_hi_95").notNull(),
    inputSnapshot: jsonb("input_snapshot").$type<Record<string, unknown>>(),
    madeAt: timestamp("made_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    participantIdx: index("predictions_participant_idx").on(t.participantId),
    modelIdx: index("predictions_model_idx").on(t.modelId),
  }),
);

export const harmonisationRuns = pgTable("harmonisation_runs", {
  id: text("id").primaryKey(),
  cohortIds: jsonb("cohort_ids").notNull().$type<string[]>(),
  modalities: jsonb("modalities").notNull().$type<string[]>(),
  params: jsonb("params").notNull().$type<Record<string, unknown>>(),
  beforeMeans: jsonb("before_means").$type<Record<string, Record<string, number>>>(),
  afterMeans: jsonb("after_means").$type<Record<string, Record<string, number>>>(),
  status: text("status", { enum: ["queued", "running", "succeeded", "failed"] })
    .notNull()
    .default("queued"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const harmonisedFeatures = pgTable(
  "harmonised_features",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => harmonisationRuns.id, { onDelete: "cascade" }),
    visitId: text("visit_id")
      .notNull()
      .references(() => visits.id, { onDelete: "cascade" }),
    modality: text("modality").notNull(),
    payload: jsonb("payload").notNull().$type<Record<string, number>>(),
  },
  (t) => ({
    runIdx: index("harmonised_features_run_idx").on(t.runId),
    visitIdx: index("harmonised_features_visit_idx").on(t.visitId),
    modalityIdx: index("harmonised_features_modality_idx").on(t.modality),
  }),
);

export const audits = pgTable("audits", {
  id: text("id").primaryKey(),
  modelId: text("model_id")
    .notNull()
    .references(() => models.id, { onDelete: "cascade" }),
  calibration: jsonb("calibration").$type<
    Record<string, Array<{ predicted: number; observed: number; n: number }>>
  >(),
  subgroups: jsonb("subgroups").$type<
    Array<{
      subgroup: string;
      value: string;
      n: number;
      auroc: Record<string, number>;
      auprc: Record<string, number>;
      calibration_error: Record<string, number>;
    }>
  >(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Participant = typeof participants.$inferSelect;
export type Visit = typeof visits.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Model = typeof models.$inferSelect;
export type Prediction = typeof predictions.$inferSelect;
