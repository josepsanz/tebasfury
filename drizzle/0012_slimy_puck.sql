ALTER TABLE "squad_members" ADD COLUMN "buyout_clause" bigint;--> statement-breakpoint
ALTER TABLE "squad_members" ADD COLUMN "clause_locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "squad_members" ADD COLUMN "shielded" boolean DEFAULT false NOT NULL;