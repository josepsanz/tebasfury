import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/lib/db/testing";
import { loadRefreshToken, saveRefreshToken } from "./credentials";
import { CredentialError, getAccessToken } from "./index";

// `getEnv()` validates the whole application configuration as a single
// object, so exercising CREDENTIALS_KEY here still requires stubbing the
// other required variables with dummy values — none of them are read by
// this module.
process.env.DATABASE_URL = "postgres://user:pass@host/db";
process.env.BETTER_AUTH_SECRET = "x".repeat(32);
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.GOOGLE_CLIENT_ID = "google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "google-client-secret";

process.env.CREDENTIALS_KEY = Buffer.alloc(32, 5).toString("base64");

describe("getAccessToken", () => {
  let h: TestDatabase;
  beforeAll(async () => {
    h = await createTestDatabase();
  });
  afterAll(async () => {
    await h.close();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws a CredentialError when nothing is stored", async () => {
    await expect(getAccessToken(h.db)).rejects.toBeInstanceOf(CredentialError);
  });

  it("exchanges the stored token and persists the rotation", async () => {
    await saveRefreshToken(h.db, { refreshToken: "old", clientId: "cid", updatedBy: "u" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ access_token: "at", refresh_token: "new", expires_in: 86400 }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    expect(await getAccessToken(h.db)).toBe("at");
    expect((await loadRefreshToken(h.db))?.refreshToken).toBe("new");
  });

  it("keeps the previous token when the response omits a new one", async () => {
    await saveRefreshToken(h.db, { refreshToken: "keep-me", clientId: "cid", updatedBy: "u" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ access_token: "at", expires_in: 86400 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await getAccessToken(h.db);
    expect((await loadRefreshToken(h.db))?.refreshToken).toBe("keep-me");
  });

  it("throws a CredentialError when the provider rejects the token", async () => {
    await saveRefreshToken(h.db, { refreshToken: "expired", clientId: "cid", updatedBy: "u" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })),
    );

    await expect(getAccessToken(h.db)).rejects.toBeInstanceOf(CredentialError);
  });
});
