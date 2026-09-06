import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/lib/db/testing";
import { leagueCredentials } from "@/lib/db/schema";
import { loadRefreshToken, saveRefreshToken } from "./credentials";
import {
  CredentialError,
  createClient,
  getAccessToken,
  getCurrentWeek,
  getStanding,
} from "./index";
import live from "./__fixtures__/standing-live.json";
import settled from "./__fixtures__/standing-settled.json";
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
process.env.QSTASH_TOKEN = "qstash-token";
process.env.QSTASH_CURRENT_SIGNING_KEY = "sig-current";
process.env.QSTASH_NEXT_SIGNING_KEY = "sig-next";

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

  // Last in this block: it leaves the stored credential unreadable on purpose.
  it("throws a CredentialError when the stored credential cannot be decrypted", async () => {
    await saveRefreshToken(h.db, { refreshToken: "sealed", clientId: "cid", updatedBy: "u" });
    await h.db
      .update(leagueCredentials)
      .set({ refreshTokenSealed: "AAAA.BBBB.CCCC" })
      .where(eq(leagueCredentials.id, "league"));

    // A rotated CREDENTIALS_KEY used to escape as a plain Error, so the admin page's
    // "the credential needs re-bootstrapping" branch never fired for it and the
    // screen showed `Unsupported state or unable to authenticate data` instead.
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
    expect(week.number).toBe(4);
    expect(week.isLive).toBe(true);
    expect(week.opensAt.toISOString()).toBe("2026-09-04T19:00:00.000Z");
    expect(week.closesAt.toISOString()).toBe("2026-09-08T01:00:00.000Z");
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

  it("carries what the API objected to into the error, not only that it objected", async () => {
    stubFetch({ code: 400, message: "leagueId is not a number" }, 400);
    await expect(getStanding("at", "nope")).rejects.toThrowError(/leagueId is not a number/);
  });
});

/**
 * The two standing endpoints disagree about what `points` means, and this mapping is
 * the only place that knows. Both cases are pinned against the real captures.
 */
describe("the standing mapping", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads a live week's own score from livePoints, not from the season total", async () => {
    stubFetch(live, 200);
    const { rows } = await getStanding("at", "018012894");

    // The leader's entry: `points` 184 is the season including the round in play;
    // `teamPoints` 141 is the season before it; the round is worth 43.
    const leader = rows.find((r) => r.teamId === "9000019");
    expect(leader?.weekPoints).toBe(43);
    expect(leader?.livePoints).toBe(43);
    expect(leader?.teamPoints).toBe(141);
    expect(rows.map((r) => r.weekPoints)).toEqual(live.map((e) => e.livePoints));
  });

  it("records no round position for a live week, whose position is the table's", async () => {
    stubFetch(live, 200);
    const { rows } = await getStanding("at", "018012894");
    expect(rows.every((r) => r.roundPosition === null)).toBe(true);
  });

  it("reads a settled week's own score and its rank within the round", async () => {
    stubFetch(settled, 200);
    const { rows } = await getStanding("at", "018012894", 3);
    expect(rows.map((r) => r.weekPoints)).toEqual(settled.map((e) => e.points));
    expect(rows.map((r) => r.roundPosition)).toEqual(settled.map((e) => e.position));
    expect(rows.every((r) => r.livePoints === null)).toBe(true);
  });

  it("hands back the undecoded response, so the archive keeps what the parse drops", async () => {
    stubFetch(live, 200);
    const { raw } = await getStanding("at", "018012894");
    expect(raw).toEqual(live);
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
