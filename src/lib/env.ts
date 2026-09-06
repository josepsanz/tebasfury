import { z } from "zod";

// El secret publicat com a exemple a `.env.example`: cal rebutjar-lo
// explícitament perquè ningú desplegui amb el secret que tothom pot llegir
// al repositori.
const SECRET_D_EXEMPLE = "genera'l amb: openssl rand -base64 32";

const envSchema = z.object({
  DATABASE_URL: z.url(),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32)
    .refine((valor) => valor !== SECRET_D_EXEMPLE, {
      message: "no es pot fer servir el secret d'exemple de .env.example",
    }),
  BETTER_AUTH_URL: z.url(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const noms = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Configuració d'entorn invàlida: ${noms}`);
  }
  return result.data;
}

let memo: Env | undefined;

export function getEnv(): Env {
  memo ??= parseEnv(process.env);
  return memo;
}
