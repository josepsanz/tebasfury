import { defineConfig } from "drizzle-kit";

// drizzle-kit bundles its own dotenv, which only ever reads `.env` — never
// `.env.local`. Next.js does read `.env.local`, so we load it here too, and
// `pnpm drizzle-kit migrate` ends up using the same configuration as
// `pnpm dev`. `process.loadEnvFile` does not overwrite variables already set
// in the environment (such as the inline `DATABASE_URL` that
// `docs/deployment.md` uses for production).
try {
  process.loadEnvFile(".env.local");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "Invalid environment configuration: DATABASE_URL must be set in .env.local " +
      "(or in the environment) before running drizzle-kit.",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: databaseUrl },
});
