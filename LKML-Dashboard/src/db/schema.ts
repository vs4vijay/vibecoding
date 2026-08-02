import { relations } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const SERIES_STATUSES = [
  'new',
  'review',
  'accepted',
  'superseded',
  'rejected',
  'merged',
  'ignored',
] as const;

export type SeriesStatus = (typeof SERIES_STATUSES)[number];

export const REVIEW_KINDS = [
  'comment',
  'acked',
  'reviewed',
  'tested',
  'nacked',
] as const;

export type ReviewKind = (typeof REVIEW_KINDS)[number];

export const JOB_STATUSES = [
  'pending',
  'running',
  'done',
  'failed',
  'cancelled',
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const patchSeries = pgTable(
  'patch_series',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: text('message_id').notNull().unique(),
    subject: text('subject').notNull(),
    author: text('author').notNull(),
    authorEmail: text('author_email'),
    date: timestamp('date', { withTimezone: true }).notNull(),
    version: integer('version').notNull().default(1),
    numPatches: integer('num_patches').notNull().default(1),
    status: text('status')
      .$type<SeriesStatus>()
      .notNull()
      .default('new'),
    source: text('source').notNull().default('patchwork'),
    project: text('project'),
    webUrl: text('web_url'),
    threadUrl: text('thread_url'),
    coverLetter: text('cover_letter'),
    summary: text('summary'),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('patch_series_status_idx').on(t.status),
    index('patch_series_author_idx').on(t.author),
    index('patch_series_date_idx').on(t.date),
  ],
);

export type PatchSeries = typeof patchSeries.$inferSelect;
export type NewPatchSeries = typeof patchSeries.$inferInsert;

export const patches = pgTable(
  'patches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    seriesId: uuid('series_id')
      .notNull()
      .references(() => patchSeries.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    subject: text('subject').notNull(),
    messageId: text('message_id'),
    state: text('state').notNull().default('New'),
    diffStats: jsonb('diff_stats')
      .$type<{ added: number; removed: number } | null>()
      .default(null),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('patches_series_idx').on(t.seriesId),
    index('patches_position_idx').on(t.seriesId, t.position),
  ],
);

export type Patch = typeof patches.$inferSelect;
export type NewPatch = typeof patches.$inferInsert;

export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    seriesId: uuid('series_id')
      .notNull()
      .references(() => patchSeries.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<ReviewKind>().notNull().default('comment'),
    author: text('author').notNull(),
    subject: text('subject'),
    body: text('body'),
    messageId: text('message_id'),
    date: timestamp('date', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('reviews_series_idx').on(t.seriesId),
    index('reviews_author_idx').on(t.author),
  ],
);

export type Review = typeof reviews.$inferSelect;
export type NewReview = typeof reviews.$inferInsert;

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown> | null>().default(null),
    status: text('status').$type<JobStatus>().notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    error: text('error'),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    lockedBy: text('locked_by'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    runAt: timestamp('run_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('jobs_status_available_idx').on(t.status, t.availableAt),
    index('jobs_type_idx').on(t.type),
  ],
);

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;

export const ingestState = pgTable(
  'ingest_state',
  {
    key: text('key').primaryKey(),
    value: jsonb('value').$type<Record<string, unknown> | null>().default(null),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ingest_state_updated_idx').on(t.updatedAt)],
);

export type IngestState = typeof ingestState.$inferSelect;

export const patchSeriesRelations = relations(patchSeries, ({ many }) => ({
  patches: many(patches),
  reviews: many(reviews),
}));

export const patchesRelations = relations(patches, ({ one }) => ({
  series: one(patchSeries, { fields: [patches.seriesId], references: [patchSeries.id] }),
}));

export const reviewsRelations = relations(reviews, ({ one }) => ({
  series: one(patchSeries, { fields: [reviews.seriesId], references: [patchSeries.id] }),
}));

export const jobsRelations = relations(jobs, () => ({}));
