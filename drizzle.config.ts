import { defineConfig } from "drizzle-kit";

// drizzle-kit incorpora el seu propi dotenv, que només llegeix `.env` — mai
// `.env.local`. Next.js sí que llegeix `.env.local`, així que ho fem nosaltres
// també aquí perquè `pnpm drizzle-kit migrate` faci servir la mateixa
// configuració que `pnpm dev`. `process.loadEnvFile` no sobreescriu variables
// que ja existeixin a l'entorn (p. ex. la `DATABASE_URL` inline que fa servir
// `docs/desplegament.md` per a producció).
try {
  process.loadEnvFile(".env.local");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "Configuració d'entorn invàlida: cal definir DATABASE_URL a .env.local (o a l'entorn) " +
      "abans d'executar drizzle-kit.",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: databaseUrl },
});
