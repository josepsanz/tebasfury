CREATE TABLE "league_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"refresh_token_sealed" text NOT NULL,
	"client_id" text NOT NULL,
	"rotated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL
);
