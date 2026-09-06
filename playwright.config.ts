import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:3000" },
  webServer: {
    command: "pnpm build && pnpm start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // Dummy values: `pnpm build` loads `auth.ts`, which calls `getEnv()` at
    // module load. None of the tests go through Google, so neither real
    // credentials nor a `.env.local` on disk are needed.
    env: {
      DATABASE_URL: "postgres://user:password@localhost:5432/tebasfury_e2e",
      BETTER_AUTH_SECRET: "e2e-dummy-secret-that-is-at-least-32-chars-long",
      BETTER_AUTH_URL: "http://localhost:3000",
      GOOGLE_CLIENT_ID: "e2e-dummy-google-client-id",
      GOOGLE_CLIENT_SECRET: "e2e-dummy-google-client-secret",
      CREDENTIALS_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      LALIGA_LEAGUE_ID: "test-league",
      QSTASH_TOKEN: "qstash-dummy-token",
      QSTASH_CURRENT_SIGNING_KEY: "sig-current",
      QSTASH_NEXT_SIGNING_KEY: "sig-next",
    },
  },
});
