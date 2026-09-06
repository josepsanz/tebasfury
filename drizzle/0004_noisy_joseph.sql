ALTER TABLE "gameweeks" ALTER COLUMN "opens_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "gameweeks" ALTER COLUMN "closes_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "team_gameweek_stats" ALTER COLUMN "round_position" DROP NOT NULL;