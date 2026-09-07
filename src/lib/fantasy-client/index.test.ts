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
  getPlayers,
  getSquad,
  getStanding,
} from "./index";
import live from "./__fixtures__/standing-live.json";
import settled from "./__fixtures__/standing-settled.json";
import weekFixture from "./__fixtures__/week-current.json";
import playersFixture from "./__fixtures__/players.json";
import squadFixture from "./__fixtures__/squad.json";

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

/**
 * The catalogue as it arrives: quoted numbers, and a `weekPoints` array whose entries
 * name their own gameweek. The fixture's JSON type is a union of the entries that do
 * and do not carry `lastSeasonPoints`, which is awkward to read through; this names
 * the fields the assertions below actually use.
 */
type CapturedPlayer = {
  id: string;
  nickname: string;
  positionId: string;
  playerStatus: string;
  marketValue: string;
  points: number;
  weekPoints: { weekNumber: number; points: number }[];
  image: string;
  teamId: string;
};
const captured = playersFixture as CapturedPlayer[];

/**
 * The catalogue's own shape is what these pin. Its `weekPoints` arrays are sparse and
 * unordered — in the capture two clubs had played their gameweek-6 fixture and not
 * their fourth, gameweek 5 appears nowhere, and 179 of the 836 players' arrays are
 * not in ascending order — so the gameweek an entry names is the only safe way to
 * read it, and that is what the mapping produces.
 */
describe("the players mapping", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps every captured player into a domain row", async () => {
    stubFetch(playersFixture, 200);
    const rows = await getPlayers("at");
    expect(rows).toHaveLength(captured.length);
    expect(rows.every((r) => typeof r.id === "string" && r.id.length > 0)).toBe(true);
    expect(rows.every((r) => typeof r.nickname === "string")).toBe(true);
  });

  it("hands on numbers where the catalogue quoted them", async () => {
    // `marketValue` arrives as "46122750". A string would reach a numeric column and
    // sort as text, which puts 9,298,946 above 46,122,750.
    stubFetch(playersFixture, 200);
    const rows = await getPlayers("at");
    expect(rows.map((r) => r.marketValue)).toEqual(captured.map((p) => Number(p.marketValue)));
    expect(rows.map((r) => r.realTeamId)).toEqual(captured.map((p) => p.teamId));
  });

  it("names the position rather than handing on the API's id", async () => {
    // A number is not something a catalogue can print. The map lives in the client
    // because deciding what a field MEANS is this directory's whole job. An id the
    // map does not know falls through as a digit, and this is what catches it.
    stubFetch(playersFixture, 200);
    const rows = await getPlayers("at");
    expect(rows.every((r) => /^[A-Za-z]/.test(r.position))).toBe(true);
  });

  it("keeps the API's own word for availability", async () => {
    stubFetch(playersFixture, 200);
    const rows = await getPlayers("at");
    const statuses = new Set(captured.map((p) => p.playerStatus));
    expect(new Set(rows.map((r) => r.status))).toEqual(statuses);
  });

  it("files each score under the gameweek the API named, not under its place in the array", async () => {
    // Remiro's four scores arrive as gameweeks 2, 1, 3 and 6: his club had played its
    // sixth fixture and not its fourth. Read by index, his 10-point gameweek 6 would
    // be filed as gameweek 4 — which is the season's history quietly falsified.
    stubFetch(playersFixture, 200);
    const rows = await getPlayers("at");

    expect(captured.find((p) => p.id === "274")?.weekPoints.map((w) => w.weekNumber)).toEqual(
      [2, 1, 3, 6],
    );
    expect(rows.find((r) => r.id === "274")?.weekPoints).toEqual([
      { week: 1, points: 4 },
      { week: 2, points: 8 },
      { week: 3, points: 4 },
      { week: 6, points: 10 },
    ]);
  });

  it("orders every player's gameweeks ascending, however they arrived", async () => {
    // Not cosmetic: a caller charting the array in the order it arrived would draw a
    // season that jumps backwards for 179 of the 836 players in the capture.
    stubFetch(playersFixture, 200);
    const rows = await getPlayers("at");
    for (const [i, row] of rows.entries()) {
      expect(row.weekPoints.map((w) => w.week)).toEqual(
        captured[i].weekPoints.map((w) => w.weekNumber).sort((a, b) => a - b),
      );
    }
  });

  it("loses no score on the way through, and they still sum to the season total", async () => {
    // The sum identity holds for all 836 players in the capture. It is the evidence
    // that `weekPoints` is the whole of a player's season, so a shape change breaks a
    // test rather than a season's history.
    stubFetch(playersFixture, 200);
    const rows = await getPlayers("at");
    for (const [i, row] of rows.entries()) {
      expect(row.weekPoints).toHaveLength(captured[i].weekPoints.length);
      expect(row.weekPoints.reduce((s, w) => s + w.points, 0)).toBe(captured[i].points);
    }
  });

  it("asks the competition's catalogue endpoint", async () => {
    const fetchMock = stubFetch(playersFixture, 200);
    await getPlayers("at");
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/competition\/1\/players$/);
  });

  it("throws when the response no longer matches the schema", async () => {
    stubFetch([{ unexpected: true }], 200);
    await expect(getPlayers("at")).rejects.toThrowError();
  });

  it("throws rather than guess when a score loses the gameweek it belongs to", async () => {
    // The shape the brief assumed: a bare array of numbers. If the API ever sends it,
    // there is no honest way to know which gameweek each number is, so it fails here.
    const withoutLabels = captured.map((p) => ({
      ...p,
      weekPoints: p.weekPoints.map((w) => w.points),
    }));
    stubFetch(withoutLabels, 200);
    await expect(getPlayers("at")).rejects.toThrowError();
  });
});

describe("the squad mapping", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns one player id per squad entry, dropping none", async () => {
    // Dropping an entry would quietly shrink a squad and make an owned player look
    // free, so the count is asserted rather than the ids alone.
    stubFetch(squadFixture, 200);
    const squad = await getSquad("at", "018012894", "9000019");
    expect(squad.playerIds).toHaveLength(squadFixture.players.length);
    expect(squad.playerIds.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
    expect(squad.teamId).toBe("9000019");
  });

  it("asks for the team inside the league", async () => {
    const fetchMock = stubFetch(squadFixture, 200);
    await getSquad("at", "018012894", "9000019");
    expect(fetchMock.mock.calls[0][0]).toContain("/leagues/018012894/teams/9000019");
  });

  it("returns the clubs named in the squad, deduplicated", async () => {
    // The committed fixture's 15 entries name 10 distinct clubs — several players
    // share one. A squad's clubs are a set, not a list parallel to its players.
    stubFetch(squadFixture, 200);
    const squad = await getSquad("at", "018012894", "9000019");
    expect(squad.realTeams).toHaveLength(10);
    expect(squad.realTeams).toContainEqual({
      id: "14",
      name: "Rayo Vallecano",
      slug: "rayo-vallecano",
      badgeUrl:
        "https://assets-fantasy.llt-services.com/teambadge/t184/color/t184_rayo-vallecano.png",
    });
  });

  it("learns no club, rather than throwing, when an entry carries no team", async () => {
    // Every entry in the one capture carries `team`, but one capture is not a
    // specification. A response that omits it must leave the club unlearned — never
    // fail the sweep for that team.
    stubFetch({ id: "9000019", players: [{ playerMaster: { id: "p1" } }] }, 200);
    const squad = await getSquad("at", "018012894", "9000019");
    expect(squad.playerIds).toEqual(["p1"]);
    expect(squad.realTeams).toEqual([]);
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
