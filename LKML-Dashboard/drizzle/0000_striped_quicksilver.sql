CREATE TABLE "ingest_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb DEFAULT 'null'::jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT 'null'::jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"error" text,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_by" text,
	"locked_at" timestamp with time zone,
	"run_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patch_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" text NOT NULL,
	"subject" text NOT NULL,
	"author" text NOT NULL,
	"author_email" text,
	"date" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"num_patches" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"source" text DEFAULT 'patchwork' NOT NULL,
	"project" text,
	"web_url" text,
	"thread_url" text,
	"cover_letter" text,
	"summary" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patch_series_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
CREATE TABLE "patches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"series_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"subject" text NOT NULL,
	"message_id" text,
	"state" text DEFAULT 'New' NOT NULL,
	"diff_stats" jsonb DEFAULT 'null'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"series_id" uuid NOT NULL,
	"kind" text DEFAULT 'comment' NOT NULL,
	"author" text NOT NULL,
	"subject" text,
	"body" text,
	"message_id" text,
	"date" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "patches" ADD CONSTRAINT "patches_series_id_patch_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."patch_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_series_id_patch_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."patch_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingest_state_updated_idx" ON "ingest_state" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "jobs_status_available_idx" ON "jobs" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "jobs_type_idx" ON "jobs" USING btree ("type");--> statement-breakpoint
CREATE INDEX "patch_series_status_idx" ON "patch_series" USING btree ("status");--> statement-breakpoint
CREATE INDEX "patch_series_author_idx" ON "patch_series" USING btree ("author");--> statement-breakpoint
CREATE INDEX "patch_series_date_idx" ON "patch_series" USING btree ("date");--> statement-breakpoint
CREATE INDEX "patches_series_idx" ON "patches" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX "patches_position_idx" ON "patches" USING btree ("series_id","position");--> statement-breakpoint
CREATE INDEX "reviews_series_idx" ON "reviews" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX "reviews_author_idx" ON "reviews" USING btree ("author");