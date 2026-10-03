CREATE TABLE "market_listings" (
	"player_id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"seller_team_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"bids" integer,
	"read_at" timestamp with time zone NOT NULL,
	CONSTRAINT "market_listings_kind_check" CHECK ("market_listings"."kind" in ('league', 'team'))
);
--> statement-breakpoint
ALTER TABLE "market_listings" ADD CONSTRAINT "market_listings_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;