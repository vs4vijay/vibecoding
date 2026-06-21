CREATE TYPE "public"."achievement_type" AS ENUM('distance', 'coins', 'score', 'combo', 'powerup');--> statement-breakpoint
CREATE TYPE "public"."powerup_type" AS ENUM('magnet', 'jetpack', 'multiplier', 'super_sneakers');--> statement-breakpoint
CREATE TABLE "achievements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(100) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text NOT NULL,
	"icon" varchar(10) NOT NULL,
	"type" "achievement_type" NOT NULL,
	"requirement_distance" integer,
	"requirement_coins" integer,
	"requirement_score" integer,
	"requirement_combo" integer,
	"requirement_powerups" integer,
	CONSTRAINT "achievements_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar(50) NOT NULL,
	"payload" text NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "player_achievements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"achievement_id" uuid NOT NULL,
	"unlocked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_powerups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"type" "powerup_type" NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar(50) NOT NULL,
	"display_name" varchar(100) NOT NULL,
	"avatar_url" varchar(500),
	"total_distance" integer DEFAULT 0 NOT NULL,
	"total_coins" integer DEFAULT 0 NOT NULL,
	"high_score" integer DEFAULT 0 NOT NULL,
	"games_played" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"distance" real NOT NULL,
	"coins_collected" integer DEFAULT 0 NOT NULL,
	"multiplier" integer DEFAULT 1 NOT NULL,
	"obstacles_dodged" integer DEFAULT 0 NOT NULL,
	"powerups_used" integer DEFAULT 0 NOT NULL,
	"max_combo" integer DEFAULT 0 NOT NULL,
	"play_time_seconds" real NOT NULL,
	"played_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "player_achievements" ADD CONSTRAINT "player_achievements_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_achievements" ADD CONSTRAINT "player_achievements_achievement_id_achievements_id_fk" FOREIGN KEY ("achievement_id") REFERENCES "public"."achievements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_powerups" ADD CONSTRAINT "player_powerups_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_status_type_idx" ON "jobs" USING btree ("status","type");--> statement-breakpoint
CREATE INDEX "jobs_created_at_idx" ON "jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "players_username_idx" ON "players" USING btree ("username");--> statement-breakpoint
CREATE INDEX "players_high_score_idx" ON "players" USING btree ("high_score");--> statement-breakpoint
CREATE INDEX "runs_player_id_idx" ON "runs" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "runs_score_idx" ON "runs" USING btree ("score");--> statement-breakpoint
CREATE INDEX "runs_played_at_idx" ON "runs" USING btree ("played_at");