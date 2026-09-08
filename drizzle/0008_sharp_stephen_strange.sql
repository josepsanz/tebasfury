CREATE TABLE "market_operations" (
	"id" text PRIMARY KEY NOT NULL,
	"activity_type" integer NOT NULL,
	"actor_manager_id" integer NOT NULL,
	"counterparty_manager_id" integer,
	"player_id" text,
	"amount" bigint,
	"week_number" integer,
	"occurred_at" timestamp with time zone NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "market_operations_occurred_at_idx" ON "market_operations" USING btree ("occurred_at");