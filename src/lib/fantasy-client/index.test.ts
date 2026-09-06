import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/lib/db/testing";
import { loadRefreshToken, saveRefreshToken } from "./credentials";
import {
  CredentialError,
  createClient,
  getAccessToken,
  getCurrentWeek,
  getStanding,
} from "./index";
import live from "./__fixtures__/standing-live.json";
import weekFixture from "./__fixtures__/week-current.json";

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

type FetchCall = [string, RequestInit];

/** A `fetch` stub typed by parameters, so `mock.calls` carries the URL and init. */
function stubFetch(body: unknown, status: number) {
  const mock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    async () => new Response(JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("data calls", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses the current week", async () => {
    stubFetch(weekFixture, 200);
    const week = await getCurrentWeek("at");
    expect(week.weekNumber).toBe(4);
    expect(week.isLive).toBe(true);
  });

  it("sends the access token as a bearer credential", async () => {
    const fetchMock = stubFetch(live, 200);
    await getStanding("my-token", "018012894");
    const [, init] = fetchMock.mock.calls[0] as FetchCall;
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer my-token");
  });

  it("asks for a specific gameweek when one is given", async () => {
    const fetchMock = stubFetch(live, 200);
    await getStanding("at", "018012894", 3);
    expect(fetchMock.mock.calls[0][0]).toContain("/standing/3");
  });

  it("asks for the live table when no gameweek is given", async () => {
    const fetchMock = stubFetch(live, 200);
    await getStanding("at", "018012894");
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/standing$/);
  });

  it("throws when the API answers with an error", async () => {
    stubFetch({ code: 404, message: "Not Found" }, 404);
    await expect(getStanding("at", "nope")).rejects.toThrowError(/404/);
  });

  it("throws when the response no longer matches the schema", async () => {
    stubFetch([{ unexpected: true }], 200);
    await expect(getStanding("at", "018012894")).rejects.toThrowError();
  });
});

describe("createClient", () => {
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

  it("exchanges the credential once and binds it to every call the client makes", async () => {
    await saveRefreshToken(h.db, { refreshToken: "old", clientId: "cid", updatedBy: "u" });
    let tokenExchanges = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("login.laliga.es")) {
          tokenExchanges += 1;
          return new Response(
            JSON.stringify({ access_token: "at", refresh_token: "new", expires_in: 86400 }),
            { status: 200 },
          );
        }
        if (url.includes("/week/current")) {
          return new Response(JSON.stringify(weekFixture), { status: 200 });
        }
        return new Response(JSON.stringify(live), { status: 200 });
      }),
    );

    const client = await createClient(h.db, "018012894");
    await client.getCurrentWeek();
    await client.getStanding();
    await client.getStanding(3);

    expect(tokenExchanges).toBe(1);
  });
});
