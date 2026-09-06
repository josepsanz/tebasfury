CREATE TABLE "gameweeks" (
	"number" integer PRIMARY KEY NOT NULL,
	"opens_at" timestamp with time zone NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"is_live" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_sync_payloads" (
	"id" text PRIMARY KEY NOT NULL,
	"endpoint" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"weeks_synced" integer,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "team_gameweek_stats" (
	"team_id" text NOT NULL,
	"gameweek" integer NOT NULL,
	"points" integer NOT NULL,
	"round_position" integer NOT NULL,
	"live_points" integer,
	"is_provisional" boolean DEFAULT false NOT NULL,
	"team_value" bigint,
	"team_points" integer,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_gameweek_stats_team_id_gameweek_pk" PRIMARY KEY("team_id","gameweek")
);
--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "manager_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "team_gameweek_stats" ADD CONSTRAINT "team_gameweek_stats_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_gameweek_stats" ADD CONSTRAINT "team_gameweek_stats_gameweek_gameweeks_number_fk" FOREIGN KEY ("gameweek") REFERENCES "public"."gameweeks"("number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "teams" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "fantasy_team_id";