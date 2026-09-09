CREATE TABLE "necroporra_rounds" (
	"gameweek" integer PRIMARY KEY NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "necroporra_votes" (
	"gameweek" integer NOT NULL,
	"user_id" text NOT NULL,
	"first_team_id" text,
	"second_team_id" text,
	"cast_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "necroporra_votes_gameweek_user_id_pk" PRIMARY KEY("gameweek","user_id"),
	CONSTRAINT "necroporra_votes_distinct_teams" CHECK ("necroporra_votes"."first_team_id" is null or "necroporra_votes"."second_team_id" is null or "necroporra_votes"."first_team_id" <> "necroporra_votes"."second_team_id")
);
--> statement-breakpoint
ALTER TABLE "necroporra_votes" ADD CONSTRAINT "necroporra_votes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "necroporra_votes" ADD CONSTRAINT "necroporra_votes_first_team_id_teams_id_fk" FOREIGN KEY ("first_team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "necroporra_votes" ADD CONSTRAINT "necroporra_votes_second_team_id_teams_id_fk" FOREIGN KEY ("second_team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;