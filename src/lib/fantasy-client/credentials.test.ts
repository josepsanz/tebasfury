import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/lib/db/testing";
import { leagueCredentials } from "@/lib/db/schema";
import { loadRefreshToken, saveRefreshToken } from "./credentials";

// `getEnv()` validates the whole application configuration as a single
// object, so exercising CREDENTIALS_KEY here still requires stubbing the
// other required variables with dummy values — none of them are read by
// this module.
process.env.DATABASE_URL = "postgres://user:pass@host/db";
process.env.BETTER_AUTH_SECRET = "x".repeat(32);
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.GOOGLE_CLIENT_ID = "google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "google-client-secret";
process.env.LALIGA_LEAGUE_ID = "test-league";

process.env.CREDENTIALS_KEY = Buffer.alloc(32, 3).toString("base64");

describe("credential storage", () => {
  let h: TestDatabase;
  beforeAll(async () => {
    h = await createTestDatabase();
  });
  afterAll(async () => {
    await h.close();
  });

  it("returns null when nothing has been stored", async () => {
    expect(await loadRefreshToken(h.db)).toBeNull();
  });

  it("stores a token and reads it back", async () => {
    await saveRefreshToken(h.db, { refreshToken: "tok-1", clientId: "cid", updatedBy: "u1" });
    expect(await loadRefreshToken(h.db)).toEqual({ refreshToken: "tok-1", clientId: "cid" });
  });

  it("never writes the token in the clear", async () => {
    await saveRefreshToken(h.db, { refreshToken: "tok-secret", clientId: "cid", updatedBy: "u1" });
    const [row] = await h.db.select().from(leagueCredentials);
    expect(row.refreshTokenSealed).not.toContain("tok-secret");
  });

  it("replaces the token on rotation rather than adding a row", async () => {
    await saveRefreshToken(h.db, { refreshToken: "tok-2", clientId: "cid", updatedBy: "u1" });
    await saveRefreshToken(h.db, { refreshToken: "tok-3", clientId: "cid", updatedBy: "u1" });
    expect(await h.db.select().from(leagueCredentials)).toHaveLength(1);
    expect((await loadRefreshToken(h.db))?.refreshToken).toBe("tok-3");
  });
});
