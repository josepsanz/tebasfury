import { describe, expect, it } from "vitest";
import {
  bestValueForMoney,
  buildCatalogue,
  clubOrPosition,
  filterCatalogue,
  formatMoney,
  freeAndScoring,
  ownerDisplay,
  parseCatalogueEntry,
  pointsPerMillion,
  pointsTrend,
  valueTrend,
  pointsSeries,
  sortCatalogue,
  statusLabel,
  valueSeries,
  type CatalogueRow,
  type PlayerRecord,
} from "./players";

const record = (id: string, over: Partial<PlayerRecord> = {}): PlayerRecord => ({
  id,
  nickname: `Player ${id}`,
  position: "Midfielder",
  realTeamId: "rt1",
  status: "ok",
  imageUrl: null,
  ...over,
});

describe("buildCatalogue", () => {
  const input = {
    players: [
      record("p1", { nickname: "Ada" }),
      record("p2", { nickname: "Bruno", position: "Forward" }),
      record("p3", { nickname: "Cleo", position: "Goalkeeper", realTeamId: "rt9" }),
    ],
    totals: [
      { playerId: "p1", seasonPoints: 40, gameweeksRecorded: 4 },
      { playerId: "p2", seasonPoints: 9, gameweeksRecorded: 3 },
    ],
    values: [
      { playerId: "p1", value: 12_000_000, takenOn: "2026-09-07" },
      { playerId: "p2", value: 4_000_000, takenOn: "2026-09-07" },
    ],
    ownership: [{ playerId: "p1", teamId: "t1", managerName: "Manager A" }],
    clubs: [{ id: "rt1", name: "FC Barcelona" }],
  };

  it("joins value, points and ownership onto every player", () => {
    const rows = buildCatalogue(input);
    const ada = rows.find((r) => r.id === "p1");
    expect(ada).toMatchObject({
      nickname: "Ada",
      currentValue: 12_000_000,
      seasonPoints: 40,
      ownerTeamId: "t1",
      ownerName: "Manager A",
    });
  });

  it("derives the average rather than storing it", () => {
    // Storing both the total and the average invites the two to disagree. The average
    // is points per gameweek recorded for that player.
    const rows = buildCatalogue(input);
    expect(rows.find((r) => r.id === "p1")?.averagePoints).toBe(10);
    expect(rows.find((r) => r.id === "p2")?.averagePoints).toBe(3);
  });

  it("marks a player nobody owns as unowned rather than guessing", () => {
    const rows = buildCatalogue(input);
    expect(rows.find((r) => r.id === "p2")?.ownerName).toBeNull();
  });

  it("keeps a player with no value snapshot and no points, as an absence", () => {
    // A player who joined the competition between sweeps has a catalogue row and
    // nothing else. A zero would be a claim; null is the truth.
    const rows = buildCatalogue(input);
    expect(rows.find((r) => r.id === "p3")).toMatchObject({
      currentValue: null,
      seasonPoints: 0,
      averagePoints: null,
    });
  });
});

describe("filterCatalogue", () => {
  const rows: CatalogueRow[] = [
    {
      id: "p1", nickname: "Ada", position: "Midfielder",
      status: "ok", currentValue: 12_000_000, seasonPoints: 40, averagePoints: 10,
      gameweeksRecorded: 4, ownerTeamId: "t1", ownerName: "Manager A",
      clubName: null,
    },
    {
      id: "p2", nickname: "Bruno", position: "Forward",
      status: "ok", currentValue: 4_000_000, seasonPoints: 9, averagePoints: 3,
      gameweeksRecorded: 3, ownerTeamId: null, ownerName: null,
      clubName: null,
    },
  ];

  it("matches a name regardless of case", () => {
    expect(filterCatalogue(rows, { query: "ad", position: null, ownership: "all" })).toHaveLength(1);
  });

  it("filters by position", () => {
    expect(filterCatalogue(rows, { query: "", position: "Forward", ownership: "all" })[0].id).toBe("p2");
  });

  it("separates the free from the owned", () => {
    expect(filterCatalogue(rows, { query: "", position: null, ownership: "free" })[0].id).toBe("p2");
    expect(filterCatalogue(rows, { query: "", position: null, ownership: "owned" })[0].id).toBe("p1");
  });

  it("returns everything when nothing is asked", () => {
    expect(filterCatalogue(rows, { query: "  ", position: null, ownership: "all" })).toHaveLength(2);
  });
});

describe("club names on the catalogue", () => {
  const row = (over: Partial<CatalogueRow> = {}): CatalogueRow => ({
    id: "p1",
    nickname: "Ada",
    position: "Midfielder",
    status: "ok",
    currentValue: 1_000_000,
    seasonPoints: 10,
    averagePoints: 5,
    gameweeksRecorded: 2,
    ownerTeamId: null,
    ownerName: null,
    clubName: "FC Barcelona",
    ...over,
  });

  it("fills the club name from the club map and leaves it null when unmapped", () => {
    const rows = buildCatalogue({
      players: [
        { id: "p1", nickname: "Ada", position: "Midfielder", realTeamId: "rt1", status: "ok", imageUrl: null },
        { id: "p2", nickname: "Bo", position: "Forward", realTeamId: "rt9", status: "ok", imageUrl: null },
      ],
      totals: [],
      values: [],
      ownership: [],
      clubs: [{ id: "rt1", name: "FC Barcelona" }],
    });
    expect(rows[0].clubName).toBe("FC Barcelona");
    expect(rows[1].clubName).toBeNull();
  });

  it("searches the club name as well as the nickname", () => {
    const rows = [row({ id: "p1", nickname: "Ada", clubName: "Real Betis" }), row({ id: "p2", nickname: "Bo" })];
    const found = filterCatalogue(rows, { query: "betis", position: null, ownership: "all" });
    expect(found.map((r) => r.id)).toEqual(["p1"]);
  });

  it("does not match a club query against a player whose club is unknown", () => {
    const rows = [row({ clubName: null })];
    expect(filterCatalogue(rows, { query: "barcelona", position: null, ownership: "all" })).toEqual([]);
  });

  it("leads the meta line with the club, and with the position when there is none", () => {
    // Rulings 4 and 5. A plain function rather than inline JSX because
    // renderToStaticMarkup cannot drive component state — this is the only way the
    // rule is provable at all.
    expect(clubOrPosition({ clubName: "Real Betis", position: "Forward" })).toBe("Real Betis");
    expect(clubOrPosition({ clubName: null, position: "Forward" })).toBe("Forward");
  });
});

describe("sortCatalogue", () => {
  const rows: CatalogueRow[] = [
    {
      id: "p1", nickname: "Zoe", position: "Midfielder", status: "ok",
      currentValue: 1_000_000, seasonPoints: 40, averagePoints: 10, gameweeksRecorded: 4,
      ownerTeamId: null, ownerName: null,
      clubName: null,
    },
    {
      id: "p2", nickname: "Ada", position: "Forward", status: "ok",
      currentValue: 9_000_000, seasonPoints: 9, averagePoints: 3, gameweeksRecorded: 3,
      ownerTeamId: null, ownerName: null,
      clubName: null,
    },
    {
      id: "p3", nickname: "Bruno", position: "Forward", status: "ok",
      currentValue: null, seasonPoints: 0, averagePoints: null, gameweeksRecorded: 0,
      ownerTeamId: null, ownerName: null,
      clubName: null,
    },
  ];

  it("puts the most valuable first", () => {
    expect(sortCatalogue(rows, "value").map((r) => r.id)).toEqual(["p2", "p1", "p3"]);
  });

  it("puts the highest scorer first", () => {
    expect(sortCatalogue(rows, "points").map((r) => r.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("sorts by name alphabetically", () => {
    expect(sortCatalogue(rows, "name").map((r) => r.id)).toEqual(["p2", "p3", "p1"]);
  });

  it("sinks the unknowns rather than treating them as zero", () => {
    // A player with no snapshot yet is not the cheapest player in the league.
    expect(sortCatalogue(rows, "average").at(-1)?.id).toBe("p3");
  });

  it("does not let a single-gameweek average dominate 'Best average'", () => {
    // Important 7: a player with one recorded gameweek and a big score used to
    // outrank a player with several steady weeks, because averagePoints alone
    // cannot tell "10 over 6 games" from "10 over 1". Below
    // MIN_GAMEWEEKS_FOR_RANKING the row sinks like a null average does — still
    // visible under every other sort, just not able to top this one on a single game.
    const oneGame: CatalogueRow = {
      id: "p4", nickname: "Kiri", position: "Forward", status: "ok",
      currentValue: 1_000_000, seasonPoints: 12, averagePoints: 12, gameweeksRecorded: 1,
      ownerTeamId: null, ownerName: null,
      clubName: null,
    };
    const steady: CatalogueRow = {
      id: "p5", nickname: "Léo", position: "Forward", status: "ok",
      currentValue: 1_000_000, seasonPoints: 30, averagePoints: 10, gameweeksRecorded: 3,
      ownerTeamId: null, ownerName: null,
      clubName: null,
    };
    expect(sortCatalogue([oneGame, steady], "average").map((r) => r.id)).toEqual(["p5", "p4"]);
  });

  it("does not mutate its input", () => {
    const before = rows.map((r) => r.id);
    sortCatalogue(rows, "value");
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});

describe("the value-for-money sort", () => {
  const row = (over: Partial<CatalogueRow> = {}): CatalogueRow => ({
    id: "p1",
    nickname: "Ada",
    position: "Midfielder",
    status: "ok",
    currentValue: 1_000_000,
    seasonPoints: 10,
    averagePoints: 5,
    gameweeksRecorded: 4,
    ownerTeamId: null,
    ownerName: null,
    clubName: null,
    ...over,
  });

  it("ranks by points per million, and demotes a single-gameweek player", () => {
    // The same trap "Best average" already had to fix: 12 points in one appearance at
    // €1.0M is 12.0 pts/M€, which would outrank 30 points across three weeks at €3.0M.
    const lucky = row({ id: "lucky", nickname: "Kiri", currentValue: 1_000_000, seasonPoints: 12, gameweeksRecorded: 1 });
    const steady = row({ id: "steady", nickname: "Léo", currentValue: 3_000_000, seasonPoints: 30, gameweeksRecorded: 3 });
    expect(sortCatalogue([lucky, steady], "perMillion").map((r) => r.id)).toEqual(["steady", "lucky"]);
  });

  it("sinks a player with no value snapshot rather than treating them as free", () => {
    const priced = row({ id: "priced", currentValue: 2_000_000, seasonPoints: 20 });
    const unpriced = row({ id: "unpriced", currentValue: null, seasonPoints: 20 });
    expect(sortCatalogue([unpriced, priced], "perMillion").map((r) => r.id)).toEqual(["priced", "unpriced"]);
  });

  it("breaks a tie by name, like every other sort", () => {
    const zoe = row({ id: "zoe", nickname: "Zoe", currentValue: 2_000_000, seasonPoints: 20 });
    const ada = row({ id: "ada", nickname: "Ada", currentValue: 2_000_000, seasonPoints: 20 });
    expect(sortCatalogue([zoe, ada], "perMillion").map((r) => r.id)).toEqual(["ada", "zoe"]);
  });

  it("ranks by the ratio itself, not by raw points", () => {
    // Both rows qualify (three-plus gameweeks each), and the cheaper, lower-scoring
    // player has the better ratio: 20 points at €2.0M is 10.0 pts/M€, against 30 points
    // at €6.0M, which is only 5.0 pts/M€. A comparator that sorted by seasonPoints
    // instead of by points-per-million would put "bigSpender" first and fail here.
    const cheaper = row({ id: "cheaper", nickname: "Cass", currentValue: 2_000_000, seasonPoints: 20, gameweeksRecorded: 3 });
    const bigSpender = row({ id: "bigSpender", nickname: "Boaz", currentValue: 6_000_000, seasonPoints: 30, gameweeksRecorded: 3 });
    expect(sortCatalogue([bigSpender, cheaper], "perMillion").map((r) => r.id)).toEqual([
      "cheaper",
      "bigSpender",
    ]);
  });
});

describe("valueSeries", () => {
  it("orders the snapshots by the day they were taken", () => {
    const series = valueSeries([
      { takenOn: "2026-09-09", value: 3 },
      { takenOn: "2026-09-07", value: 1 },
      { takenOn: "2026-09-08", value: 2 },
    ]);
    expect(series.map((p) => p.value)).toEqual([1, 2, 3]);
  });
});

describe("pointsSeries", () => {
  it("fills the gameweeks it has no row for, as gaps and not as zeros", () => {
    // A gameweek with no row was never recorded. Nought points is a different claim,
    // and the chart must not make it.
    const series = pointsSeries([
      { gameweek: 1, points: 7 },
      { gameweek: 3, points: 2 },
    ]);
    expect(series).toEqual([
      { gameweek: 1, points: 7 },
      { gameweek: 2, points: null },
      { gameweek: 3, points: 2 },
    ]);
  });

  it("is empty before anything has been swept", () => {
    expect(pointsSeries([])).toEqual([]);
  });

  it("runs to the season's last gameweek, so two players' charts share an axis", () => {
    // Measured 2026-09-09: LaLiga plays some fixtures early, so a Celta or Real Sociedad
    // player had gameweek 6 recorded while gameweek 5 had not been played by anybody.
    // Deriving the axis per player gave those 47 a six-wide chart and everyone else a
    // four-wide one — two charts on the same screen that could not be compared.
    const series = pointsSeries([{ gameweek: 1, points: 7 }], 4);
    expect(series).toEqual([
      { gameweek: 1, points: 7 },
      { gameweek: 2, points: null },
      { gameweek: 3, points: null },
      { gameweek: 4, points: null },
    ]);
  });

  it("still reaches a gameweek played ahead of the season's last, rather than hiding it", () => {
    // The early fixture is true. Truncating the axis to the league's own last week would
    // discard a real score, which is the one thing worse than an uneven axis.
    const series = pointsSeries([{ gameweek: 6, points: 13 }], 4);
    expect(series.map((p) => p.gameweek)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(series.at(-1)).toEqual({ gameweek: 6, points: 13 });
  });

  it("falls back to the player's own last gameweek when no season figure is given", () => {
    expect(pointsSeries([{ gameweek: 2, points: 3 }])).toEqual([
      { gameweek: 1, points: null },
      { gameweek: 2, points: 3 },
    ]);
  });

  it("is still empty when the season has a length but the player has no rows", () => {
    // An axis with no series on it is a chart that says nothing; the page shows its
    // "nothing recorded" state instead, and that decision stays with the caller.
    expect(pointsSeries([], 4)).toEqual([]);
  });
});

describe("pointsPerMillion", () => {
  it("is points divided by millions of market value", () => {
    expect(pointsPerMillion(40, 8_000_000)).toBe(5);
  });

  it("is unknown when the value is unknown or nothing", () => {
    expect(pointsPerMillion(40, null)).toBeNull();
    expect(pointsPerMillion(40, 0)).toBeNull();
  });
});

describe("formatMoney", () => {
  it("reads in millions above a million", () => {
    expect(formatMoney(12_400_000)).toBe("12.4M");
  });

  it("reads in thousands below one", () => {
    expect(formatMoney(840_000)).toBe("840K");
  });

  it("does not round the thousands band up into a false extra million", () => {
    // Minor 14: Math.round(999_999 / 1000) is 1000, so this used to print "1000K".
    // 314 of the 836 real players sit under €1M, and three of those currently fall
    // in exactly this band.
    expect(formatMoney(999_999)).toBe("1.0M");
    expect(formatMoney(999_499)).toBe("999K");
  });
});

describe("statusLabel", () => {
  it("renders nothing for a player who is simply available", () => {
    expect(statusLabel("ok")).toBeNull();
  });

  it("translates the known machine values to proper English", () => {
    expect(statusLabel("out_of_league")).toBe("Out of the league");
    expect(statusLabel("injured")).toBe("Injured");
    expect(statusLabel("doubtful")).toBe("Doubtful");
    expect(statusLabel("suspended")).toBe("Suspended");
  });

  it("falls back to the raw status for a value outside the known five", () => {
    // Task 1 named five real status values, and this project translates every one of
    // them to proper English. A sixth value that shows up later must still be visible
    // rather than silently vanish.
    expect(statusLabel("benched")).toBe("benched");
  });
});

describe("ownerDisplay", () => {
  it("names the owner when there is one", () => {
    expect(ownerDisplay("Manager A", true)).toEqual({ kind: "owned", name: "Manager A" });
  });

  it("calls a player free once ownership is known and no owner row exists", () => {
    expect(ownerDisplay(null, true)).toEqual({ kind: "free" });
  });

  it("does not call anyone free before any squad has been read", () => {
    // Important 2: the player detail page was making this claim from the mere
    // absence of an owner row, in the same "Free agent" colour the catalogue
    // reserves for a fact it has actually checked.
    expect(ownerDisplay(null, false)).toEqual({ kind: "unknown" });
  });
});

describe("the opportunity boards", () => {
  const row = (over: Partial<CatalogueRow> = {}): CatalogueRow => ({
    id: "p1",
    nickname: "Ada",
    position: "Midfielder",
    status: "ok",
    currentValue: 2_000_000,
    seasonPoints: 20,
    averagePoints: 5,
    gameweeksRecorded: 4,
    ownerTeamId: null,
    ownerName: null,
    clubName: null,
    ...over,
  });

  it("removes a low-sample player from the board rather than sinking them", () => {
    // Ruling 4. On the catalogue a demoted row still appears at the bottom; on a
    // five-row board that is indistinguishable from hiding, and padding the board
    // with rows that cannot be ranked is worse than a board that is honestly short.
    const lucky = row({ id: "lucky", nickname: "Kiri", currentValue: 1_000_000, seasonPoints: 12, gameweeksRecorded: 1 });
    const steady = row({ id: "steady", nickname: "Léo", seasonPoints: 20, gameweeksRecorded: 4 });
    expect(bestValueForMoney([lucky, steady]).map((r) => r.id)).toEqual(["steady"]);
  });

  it("removes a player with no value snapshot", () => {
    const unpriced = row({ id: "unpriced", currentValue: null });
    expect(bestValueForMoney([unpriced])).toEqual([]);
  });

  it("is empty rather than padded when nobody qualifies", () => {
    const nobody = row({ id: "nobody", gameweeksRecorded: 0, seasonPoints: 0 });
    expect(bestValueForMoney([nobody])).toEqual([]);
  });

  it("excludes a scoreless player even with enough recorded gameweeks and a value", () => {
    // Season points can be negative in this game, so a nought-point player would
    // otherwise pass the floor and render as "0.0 pts/M€" under a heading that says
    // "best". The board filters this the same way it filters a low sample.
    const scoreless = row({ id: "scoreless", seasonPoints: 0, gameweeksRecorded: 3 });
    expect(bestValueForMoney([scoreless])).toEqual([]);
  });

  it("caps the board at five rows", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      row({ id: `p${i}`, nickname: `Player ${i}`, seasonPoints: 30 - i }),
    );
    expect(bestValueForMoney(many)).toHaveLength(5);
    expect(bestValueForMoney(many, 2)).toHaveLength(2);
  });

  it("lists only unowned players on the free board, best scorer first", () => {
    const owned = row({ id: "owned", nickname: "Owned", seasonPoints: 40, ownerTeamId: "t1", ownerName: "Manager A" });
    const freeLow = row({ id: "free-low", nickname: "Low", seasonPoints: 5 });
    const freeHigh = row({ id: "free-high", nickname: "High", seasonPoints: 11 });
    expect(freeAndScoring([owned, freeLow, freeHigh]).map((r) => r.id)).toEqual(["free-high", "free-low"]);
  });

  it("leaves a free player who has not scored off the free board", () => {
    // The block is called "Free and scoring". A free player on nought points is not an
    // opportunity, and padding the list with them would make the heading a lie.
    const scoreless = row({ id: "scoreless", seasonPoints: 0 });
    expect(freeAndScoring([scoreless])).toEqual([]);
  });

  it("does not need a value to rank the free board", () => {
    // Ownership and points are enough. A player swept before their first value
    // snapshot still belongs here, unlike on the value-for-money board.
    const unpriced = row({ id: "unpriced", currentValue: null, seasonPoints: 7 });
    expect(freeAndScoring([unpriced]).map((r) => r.id)).toEqual(["unpriced"]);
  });
});

describe("parseCatalogueEntry", () => {
  it("reads a sort and an ownership filter it recognises", () => {
    expect(parseCatalogueEntry({ sort: "perMillion", ownership: "free" })).toEqual({
      sort: "perMillion",
      ownership: "free",
    });
  });

  it("falls back to the catalogue's own defaults for anything else", () => {
    // A URL is typed by hand, shared, and outlives the code that made it. Every
    // unrecognised value lands on the view the catalogue opens with anyway, so a stale
    // or mangled link degrades to the normal page rather than to an error.
    expect(parseCatalogueEntry({ sort: "bogus", ownership: "nobody" })).toEqual({
      sort: "value",
      ownership: "all",
    });
    expect(parseCatalogueEntry({})).toEqual({ sort: "value", ownership: "all" });
  });

  it("refuses a repeated parameter rather than guessing which one was meant", () => {
    expect(parseCatalogueEntry({ sort: ["perMillion", "points"] })).toEqual({
      sort: "value",
      ownership: "all",
    });
  });
});

describe("valueTrend", () => {
  const v = (takenOn: string, value: number) => ({ takenOn, value });

  it("measures the slope in money per DAY, not per reading", () => {
    // The distinction that matters: snapshots accumulate one per day only while the
    // sweep runs, so a chain that missed a day leaves a gap. Counting readings would
    // call this three-day rise a two-day one and inflate the slope by half.
    const trend = valueTrend([
      v("2026-09-01", 10_000_000),
      v("2026-09-03", 12_000_000),
      v("2026-09-05", 14_000_000),
    ]);
    expect(trend).toEqual({ slope: 1_000_000, rising: true });
  });

  it("reports a falling value as falling", () => {
    const trend = valueTrend([
      v("2026-09-01", 14_000_000),
      v("2026-09-02", 13_000_000),
      v("2026-09-03", 12_000_000),
    ]);
    expect(trend).toEqual({ slope: -1_000_000, rising: false });
  });

  it("is flat when the value has not moved, and flat is not rising", () => {
    const trend = valueTrend([
      v("2026-09-01", 10_000_000),
      v("2026-09-02", 10_000_000),
      v("2026-09-03", 10_000_000),
    ]);
    expect(trend).toEqual({ slope: 0, rising: false });
  });

  it("has no direction from fewer than three readings", () => {
    // A player swept twice has no direction yet, which is not the same as flat.
    expect(valueTrend([v("2026-09-01", 1), v("2026-09-02", 2)])).toBeNull();
    expect(valueTrend([])).toBeNull();
  });

  it("reads the last three readings, not the first three", () => {
    const trend = valueTrend([
      v("2026-09-01", 1_000_000),
      v("2026-09-02", 1_000_000),
      v("2026-09-03", 1_000_000),
      v("2026-09-04", 2_000_000),
      v("2026-09-05", 3_000_000),
    ]);
    expect(trend?.rising).toBe(true);
  });

  it("does not depend on the caller's array order", () => {
    const rows = [v("2026-09-03", 3), v("2026-09-01", 1), v("2026-09-02", 2)];
    expect(valueTrend(rows)).toEqual(valueTrend([...rows].reverse()));
  });
});

describe("pointsTrend", () => {
  it("measures points per gameweek", () => {
    expect(
      pointsTrend([
        { gameweek: 1, points: 2 },
        { gameweek: 2, points: 4 },
        { gameweek: 3, points: 6 },
      ]),
    ).toEqual({ slope: 2, rising: true });
  });

  it("drops a gameweek with no row rather than reading it as nought", () => {
    // A player who did not feature did not score nothing, and a zero would drag the
    // slope down with a match that never happened.
    const withGap = pointsTrend([
      { gameweek: 1, points: 10 },
      { gameweek: 2, points: null },
      { gameweek: 3, points: 10 },
      { gameweek: 4, points: 10 },
    ]);
    expect(withGap).toEqual({ slope: 0, rising: false });
  });

  it("has no direction from fewer than three played gameweeks", () => {
    expect(
      pointsTrend([
        { gameweek: 1, points: 10 },
        { gameweek: 2, points: null },
        { gameweek: 3, points: 12 },
      ]),
    ).toBeNull();
  });
});
