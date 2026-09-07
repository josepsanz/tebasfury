CREATE TABLE "player_gameweek_points" (
	"player_id" text NOT NULL,
	"gameweek" integer NOT NULL,
	"points" integer NOT NULL,
	CONSTRAINT "player_gameweek_points_player_id_gameweek_pk" PRIMARY KEY("player_id","gameweek")
);
--> statement-breakpoint
CREATE TABLE "player_value_snapshots" (
	"player_id" text NOT NULL,
	"taken_on" date NOT NULL,
	"value" bigint NOT NULL,
	CONSTRAINT "player_value_snapshots_player_id_taken_on_pk" PRIMARY KEY("player_id","taken_on")
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" text PRIMARY KEY NOT NULL,
	"nickname" text NOT NULL,
	"position" text NOT NULL,
	"real_team_id" text NOT NULL,
	"status" text NOT NULL,
	"image_url" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "squad_members" (
	"team_id" text NOT NULL,
	"player_id" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "squad_members_team_id_player_id_pk" PRIMARY KEY("team_id","player_id")
);
--> statement-breakpoint
ALTER TABLE "player_gameweek_points" ADD CONSTRAINT "player_gameweek_points_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_value_snapshots" ADD CONSTRAINT "player_value_snapshots_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad_members" ADD CONSTRAINT "squad_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad_members" ADD CONSTRAINT "squad_members_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;