ALTER TABLE "necroporra_votes" ADD COLUMN "team_id" text;--> statement-breakpoint
ALTER TABLE "necroporra_votes" ADD COLUMN "entered_by" text;--> statement-breakpoint
ALTER TABLE "necroporra_votes" ADD CONSTRAINT "necroporra_votes_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "necroporra_votes" ADD CONSTRAINT "necroporra_votes_entered_by_user_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;;--> statement-breakpoint
-- Hand-written: drizzle-kit generates schema, never data. Every vote so far was cast by a
-- manager who had claimed a team, and `teams.user_id` is unique, so this maps 1:1 and
-- cannot collide. A row that does not map stays null and stops the NEXT migration at its
-- primary key, which is the loud failure we want rather than a silently dropped vote.
UPDATE "necroporra_votes" v SET "team_id" = t."id" FROM "teams" t WHERE t."user_id" = v."user_id";
