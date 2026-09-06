import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:3000" },
  webServer: {
    command: "pnpm build && pnpm start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // Valors ficticis: `pnpm build` carrega `auth.ts`, que crida `getEnv()`
    // en temps de mòdul. Cap dels quatre tests passa per Google, així que
    // no calen credencials reals ni un `.env.local` al disc.
    env: {
      DATABASE_URL: "postgres://usuari:contrasenya@localhost:5432/tebasfury_e2e",
      BETTER_AUTH_SECRET: "e2e-dummy-secret-that-is-at-least-32-chars-long",
      BETTER_AUTH_URL: "http://localhost:3000",
      GOOGLE_CLIENT_ID: "e2e-dummy-google-client-id",
      GOOGLE_CLIENT_SECRET: "e2e-dummy-google-client-secret",
    },
  },
});
