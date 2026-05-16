import {
  pgTable,
  bigserial,
  text,
  boolean,
  jsonb,
  timestamp,
  integer,
  bigint,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Phase 0 — health probe used to validate the toolchain.
export const health = pgTable("health", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  note: text("note").notNull().default("ok"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Phase 1 — core schema.

export const sources = pgTable(
  "sources",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    http: jsonb("http").notNull(),
    pagination: jsonb("pagination").notNull(),
    recordsPath: text("records_path").notNull(),
    externalIdPath: text("external_id_path").notNull(),
    hashFields: text("hash_fields").array(),
    scheduleCron: text("schedule_cron"),
    storageMode: text("storage_mode").notNull().default("generic"),
    typedColumns: jsonb("typed_columns").notNull().default(sql`'[]'::jsonb`),
    storageTable: text("storage_table").notNull().default("entities"),
    displayColumns: jsonb("display_columns").notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    nameIdx: uniqueIndex("sources_name_idx").on(t.name),
  })
);

export const entities = pgTable(
  "entities",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    source: text("source").notNull(),
    externalId: text("external_id").notNull(),
    payload: jsonb("payload").notNull(),
    contentHash: text("content_hash").notNull(),
    versionNum: integer("version_num").notNull().default(1),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    srcExtIdx: uniqueIndex("entities_source_external_id_idx").on(t.source, t.externalId),
  })
);

export const entitiesVersions = pgTable(
  "entities_versions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    entityId: bigint("entity_id", { mode: "number" }).notNull(),
    versionNum: integer("version_num").notNull(),
    payload: jsonb("payload").notNull(),
    contentHash: text("content_hash").notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
    validTo: timestamp("valid_to", { withTimezone: true }).notNull(),
    runId: bigint("run_id", { mode: "number" }),
  },
  (t) => ({
    entityIdIdx: index("entities_versions_entity_id_idx").on(t.entityId),
  })
);

export const runs = pgTable("runs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  sourceId: bigint("source_id", { mode: "number" }).notNull(),
  sourceName: text("source_name").notNull(),
  trigger: text("trigger").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  status: text("status").notNull().default("running"),
  recordsSeen: integer("records_seen").notNull().default(0),
  recordsCreated: integer("records_created").notNull().default(0),
  recordsUpdated: integer("records_updated").notNull().default(0),
  recordsSkipped: integer("records_skipped").notNull().default(0),
  errorMessage: text("error_message"),
});

export const changeLog = pgTable(
  "change_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: bigint("run_id", { mode: "number" }),
    entityId: bigint("entity_id", { mode: "number" }).notNull(),
    storageTable: text("storage_table").notNull(),
    source: text("source").notNull(),
    externalId: text("external_id").notNull(),
    changeType: text("change_type").notNull(),
    oldHash: text("old_hash"),
    newHash: text("new_hash"),
    changedAt: timestamp("changed_at", { withTimezone: true }).defaultNow().notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (t) => ({
    changedAtIdx: index("change_log_changed_at_idx").on(t.changedAt),
    sourceIdx: index("change_log_source_idx").on(t.source),
  })
);

export const ddlLog = pgTable("ddl_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).defaultNow().notNull(),
  sourceId: bigint("source_id", { mode: "number" }),
  statement: text("statement").notNull(),
  kind: text("kind").notNull(),
  success: boolean("success").notNull().default(true),
  error: text("error"),
});

export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
export type Entity = typeof entities.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type ChangeLog = typeof changeLog.$inferSelect;
