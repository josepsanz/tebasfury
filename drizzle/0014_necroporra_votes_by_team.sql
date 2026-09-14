ALTER TABLE "necroporra_votes" DROP CONSTRAINT "necroporra_votes_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "necroporra_votes" DROP CONSTRAINT "necroporra_votes_gameweek_user_id_pk";--> statement-breakpoint
ALTER TABLE "necroporra_votes" ALTER COLUMN "team_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "necroporra_votes" ADD CONSTRAINT "necroporra_votes_gameweek_team_id_pk" PRIMARY KEY("gameweek","team_id");--> statement-breakpoint
ALTER TABLE "necroporra_votes" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "necroporra_votes" ADD CONSTRAINT "necroporra_votes_not_own_team" CHECK (("necroporra_votes"."first_team_id" is null or "necroporra_votes"."first_team_id" <> "necroporra_votes"."team_id") and ("necroporra_votes"."second_team_id" is null or "necroporra_votes"."second_team_id" <> "necroporra_votes"."team_id"));