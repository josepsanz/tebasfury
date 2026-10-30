CREATE TABLE "fair_play_rulings" (
	"sale_id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"note" text,
	"recorded_by" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fair_play_rulings_status" CHECK ("fair_play_rulings"."status" in ('pending', 'remedied', 'waived'))
);
--> statement-breakpoint
ALTER TABLE "fair_play_rulings" ADD CONSTRAINT "fair_play_rulings_sale_id_market_operations_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."market_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fair_play_rulings" ADD CONSTRAINT "fair_play_rulings_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;