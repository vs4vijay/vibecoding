CREATE TABLE IF NOT EXISTS "change_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" bigint,
	"entity_id" bigint NOT NULL,
	"storage_table" text NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"change_type" text NOT NULL,
	"old_hash" text,
	"new_hash" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ddl_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_id" bigint,
	"statement" text NOT NULL,
	"kind" text NOT NULL,
	"success" boolean DEFAULT true NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entities" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"version_num" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entities_versions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entity_id" bigint NOT NULL,
	"version_num" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone NOT NULL,
	"run_id" bigint
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entity_duplicates" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"canonical_id" bigint NOT NULL,
	"duplicate_id" bigint NOT NULL,
	"similarity" integer NOT NULL,
	"dedup_key_hash" text NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'auto' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "health" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"note" text DEFAULT 'ok' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_id" bigint NOT NULL,
	"source_name" text NOT NULL,
	"trigger" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"records_seen" integer DEFAULT 0 NOT NULL,
	"records_created" integer DEFAULT 0 NOT NULL,
	"records_updated" integer DEFAULT 0 NOT NULL,
	"records_skipped" integer DEFAULT 0 NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sources" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"http" jsonb NOT NULL,
	"pagination" jsonb NOT NULL,
	"records_path" text NOT NULL,
	"external_id_path" text NOT NULL,
	"hash_fields" text[],
	"schedule_cron" text,
	"storage_mode" text DEFAULT 'generic' NOT NULL,
	"typed_columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"storage_table" text DEFAULT 'entities' NOT NULL,
	"display_columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"category" text,
	"location" jsonb,
	"dedup" jsonb,
	"cross_dedup" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "change_log_changed_at_idx" ON "change_log" USING btree ("changed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "change_log_source_idx" ON "change_log" USING btree ("source");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "entities_source_external_id_idx" ON "entities" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entities_versions_entity_id_idx" ON "entities_versions" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sources_name_idx" ON "sources" USING btree ("name");