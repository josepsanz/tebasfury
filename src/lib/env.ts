import { z } from "zod";

// The placeholder secret published in `.env.example`. It has to be rejected
// explicitly, so nobody ends up signing sessions with a value anyone can read
// straight out of the repository.
const EXAMPLE_SECRET = "generate one with: openssl rand -base64 32";

const envSchema = z.object({
  DATABASE_URL: z.url(),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32)
    .refine((value) => value !== EXAMPLE_SECRET, {
      message: "the placeholder secret from .env.example cannot be used",
    }),
  BETTER_AUTH_URL: z.url(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  CREDENTIALS_KEY: z.string().refine((v) => Buffer.from(v, "base64").length === 32, {
    message: "must be 32 bytes, base64 encoded",
  }),
  LALIGA_LEAGUE_ID: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const names = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid environment configuration: ${names}`);
  }
  return result.data;
}

let memo: Env | undefined;

export function getEnv(): Env {
  memo ??= parseEnv(process.env);
  return memo;
}
