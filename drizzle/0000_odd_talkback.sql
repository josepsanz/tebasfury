CREATE TABLE "teams" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"manager_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
