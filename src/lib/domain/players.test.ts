import { describe, expect, it } from "vitest";
import {
  buildCatalogue,
  filterCatalogue,
  formatMoney,
  ownerDisplay,
  pointsPerMillion,
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
      record("p3", { nickname: "Cleo", position: "Goalkeeper" }),
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
    },
    {
      id: "p2", nickname: "Bruno", position: "Forward",
      status: "ok", currentValue: 4_000_000, seasonPoints: 9, averagePoints: 3,
      gameweeksRecorded: 3, ownerTeamId: null, ownerName: null,
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

describe("sortCatalogue", () => {
  const rows: CatalogueRow[] = [
    {
      id: "p1", nickname: "Zoe", position: "Midfielder", status: "ok",
      currentValue: 1_000_000, seasonPoints: 40, averagePoints: 10, gameweeksRecorded: 4,
      ownerTeamId: null, ownerName: null,
    },
    {
      id: "p2", nickname: "Ada", position: "Forward", status: "ok",
      currentValue: 9_000_000, seasonPoints: 9, averagePoints: 3, gameweeksRecorded: 3,
      ownerTeamId: null, ownerName: null,
    },
    {
      id: "p3", nickname: "Bruno", position: "Forward", status: "ok",
      currentValue: null, seasonPoints: 0, averagePoints: null, gameweeksRecorded: 0,
      ownerTeamId: null, ownerName: null,
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
    // MIN_GAMEWEEKS_FOR_AVERAGE_SORT the row sinks like a null average does — still
    // visible under every other sort, just not able to top this one on a single game.
    const oneGame: CatalogueRow = {
      id: "p4", nickname: "Kiri", position: "Forward", status: "ok",
      currentValue: 1_000_000, seasonPoints: 12, averagePoints: 12, gameweeksRecorded: 1,
      ownerTeamId: null, ownerName: null,
    };
    const steady: CatalogueRow = {
      id: "p5", nickname: "Léo", position: "Forward", status: "ok",
      currentValue: 1_000_000, seasonPoints: 30, averagePoints: 10, gameweeksRecorded: 3,
      ownerTeamId: null, ownerName: null,
    };
    expect(sortCatalogue([oneGame, steady], "average").map((r) => r.id)).toEqual(["p5", "p4"]);
  });

  it("does not mutate its input", () => {
    const before = rows.map((r) => r.id);
    sortCatalogue(rows, "value");
    expect(rows.map((r) => r.id)).toEqual(before);
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
