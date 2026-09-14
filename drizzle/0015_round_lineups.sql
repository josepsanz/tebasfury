CREATE TABLE "round_lineup_players" (
	"team_id" text NOT NULL,
	"gameweek" integer NOT NULL,
	"player_id" text NOT NULL,
	"line" text NOT NULL,
	"week_points" integer NOT NULL,
	"in_ideal" boolean DEFAULT false NOT NULL,
	CONSTRAINT "round_lineup_players_team_id_gameweek_player_id_pk" PRIMARY KEY("team_id","gameweek","player_id")
);
--> statement-breakpoint
CREATE TABLE "round_lineups" (
	"team_id" text NOT NULL,
	"gameweek" integer NOT NULL,
	"formation" text NOT NULL,
	"points" integer NOT NULL,
	"snapshot_took_on" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "round_lineups_team_id_gameweek_pk" PRIMARY KEY("team_id","gameweek")
);
--> statement-breakpoint
ALTER TABLE "round_lineup_players" ADD CONSTRAINT "round_lineup_players_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_lineups" ADD CONSTRAINT "round_lineups_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;