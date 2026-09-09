import { describe, expect, it } from "vitest";
import type { CatalogueRow } from "./players";
import {
  FORMATIONS,
  eligible,
  formationName,
  nearestFormation,
  rankFormations,
} from "./lineup";

const row = (id: string, over: Partial<CatalogueRow> = {}): CatalogueRow => ({
  id,
  nickname: id,
  position: "Midfielder",
  status: "ok",
  currentValue: 1_000_000,
  seasonPoints: 10,
  averagePoints: 2.5,
  gameweeksRecorded: 4,
  ownerTeamId: "t1",
  ownerName: "Ada",
  clubName: null,
  ...over,
});

describe("FORMATIONS", () => {
  it("holds the league's seven, and only those", () => {
    expect(FORMATIONS.map(formationName)).toEqual([
      "5-4-1",
      "5-3-2",
      "4-5-1",
      "4-4-2",
      "4-3-3",
      "3-5-2",
      "3-4-3",
    ]);
  });

  it("is ten outfield players in every one, so their totals are comparable", () => {
    // The whole reason a formation's total can be ranked against another's: both are
    // eleven players, never a bigger team against a smaller one.
    for (const f of FORMATIONS) {
      expect(f.defenders + f.midfielders + f.forwards).toBe(10);
    }
  });
});

describe("eligible", () => {
  it("keeps a fit player", () => {
    expect(eligible([row("a")]).map((r) => r.id)).toEqual(["a"]);
  });

  it("drops the three statuses that make a player unfieldable", () => {
    // An optimiser that fields a suspended player has given a wrong answer, confidently.
    const rows = [
      row("hurt", { status: "injured" }),
      row("banned", { status: "suspended" }),
      row("gone", { status: "out_of_league" }),
      row("fit"),
    ];
    expect(eligible(rows).map((r) => r.id)).toEqual(["fit"]);
  });

  it("keeps a doubtful player, because doubt is a judgement and not a fact", () => {
    expect(eligible([row("maybe", { status: "doubtful" })]).map((r) => r.id)).toEqual([
      "maybe",
    ]);
  });

  it("does not disturb the caller's array", () => {
    const rows = [row("a"), row("b", { status: "injured" })];
    eligible(rows);
    expect(rows).toHaveLength(2);
  });
});

describe("rankFormations", () => {
  /** A squad big enough for every formation: 1 GK, 5 DF, 5 MF, 3 FW. */
  const full = [
    row("gk", { position: "Goalkeeper", seasonPoints: 20 }),
    ...[1, 2, 3, 4, 5].map((n) =>
      row(`d${n}`, { position: "Defender", seasonPoints: n * 10 }),
    ),
    ...[1, 2, 3, 4, 5].map((n) =>
      row(`m${n}`, { position: "Midfielder", seasonPoints: n * 10 }),
    ),
    ...[1, 2, 3].map((n) => row(`f${n}`, { position: "Forward", seasonPoints: n * 100 })),
  ];

  it("takes the best N of each line, which is the optimum and not a guess", () => {
    const best = rankFormations(full, "points").find((r) => r.name === "3-4-3");
    expect(best?.eleven.map((p) => p.id).sort()).toEqual(
      ["d3", "d4", "d5", "f1", "f2", "f3", "gk", "m2", "m3", "m4", "m5"].sort(),
    );
  });

  it("totals the eleven it picked", () => {
    // gk 20 + defenders 50+40+30 + midfielders 50+40+30+20 + forwards 300+200+100
    const best = rankFormations(full, "points").find((r) => r.name === "3-4-3");
    expect(best?.total).toBe(880);
  });

  it("puts the highest-scoring formation first", () => {
    const ranked = rankFormations(full, "points");
    expect(ranked[0].name).toBe("3-4-3");
    expect(ranked[0].total).toBeGreaterThan(ranked[1].total ?? 0);
  });

  it("picks a DIFFERENT formation under each metric, which is why both exist", () => {
    // Defenders have played all season for a steady return; forwards have played once
    // and scored well. Season points favour the many appearances, the average favours
    // the few — so the two metrics genuinely disagree about the shape of the team.
    const rows = [
      row("gk", { position: "Goalkeeper", seasonPoints: 0, averagePoints: 0 }),
      ...[1, 2, 3, 4, 5].map((n) =>
        row(`d${n}`, { position: "Defender", seasonPoints: 40, averagePoints: 10 }),
      ),
      ...[1, 2, 3, 4, 5].map((n) =>
        row(`m${n}`, { position: "Midfielder", seasonPoints: 30, averagePoints: 7.5 }),
      ),
      ...[1, 2, 3].map((n) =>
        row(`f${n}`, {
          position: "Forward",
          seasonPoints: 20,
          averagePoints: 20,
          gameweeksRecorded: 1,
        }),
      ),
    ];

    const byPoints = rankFormations(rows, "points")[0];
    expect(byPoints.name).toBe("5-4-1");
    expect(byPoints.total).toBe(340);

    const byAverage = rankFormations(rows, "average")[0];
    expect(byAverage.name).toBe("4-3-3");
    expect(byAverage.total).toBeCloseTo(122.5, 5);
  });

  it("reports a per-line shortfall instead of a total when a line is short", () => {
    // Not a boolean: "no formation possible" on a normal squad reads as a broken portal.
    const thin = [
      row("gk", { position: "Goalkeeper" }),
      ...[1, 2, 3].map((n) => row(`d${n}`, { position: "Defender" })),
      row("m1", { position: "Midfielder" }),
      ...[1, 2, 3].map((n) => row(`f${n}`, { position: "Forward" })),
    ];
    const threeFourThree = rankFormations(thin, "points").find((r) => r.name === "3-4-3");
    expect(threeFourThree?.total).toBeNull();
    expect(threeFourThree?.eleven).toEqual([]);
    expect(threeFourThree?.shortfall).toEqual({
      goalkeepers: 0,
      defenders: 0,
      midfielders: 3,
      forwards: 0,
    });
  });

  it("counts a missing goalkeeper as a shortfall of its own", () => {
    const noKeeper = [
      ...[1, 2, 3].map((n) => row(`d${n}`, { position: "Defender" })),
      ...[1, 2, 3, 4].map((n) => row(`m${n}`, { position: "Midfielder" })),
      ...[1, 2, 3].map((n) => row(`f${n}`, { position: "Forward" })),
    ];
    const ranked = rankFormations(noKeeper, "points").find((r) => r.name === "3-4-3");
    expect(ranked?.shortfall?.goalkeepers).toBe(1);
  });

  it("puts every impossible formation after every possible one", () => {
    // A squad where exactly one formation fits: 1 GK, 4 DF, 4 MF, 2 FW leaves only
    // 4-4-2. Running this against a squad that fits everything would assert nothing,
    // because there would be no impossible formation to be ordered after.
    const mixed = [
      row("gk", { position: "Goalkeeper" }),
      ...[1, 2, 3, 4].map((n) => row(`d${n}`, { position: "Defender" })),
      ...[1, 2, 3, 4].map((n) => row(`m${n}`, { position: "Midfielder" })),
      ...[1, 2].map((n) => row(`f${n}`, { position: "Forward" })),
    ];
    const ranked = rankFormations(mixed, "points");
    expect(ranked[0].name).toBe("4-4-2");
    expect(ranked[0].shortfall).toBeNull();
    expect(ranked.slice(1).every((r) => r.shortfall !== null)).toBe(true);
  });

  it("leaves out a player who cannot be fielded", () => {
    const withBan = [...full, row("banned", { position: "Forward", seasonPoints: 9999, status: "suspended" })];
    const best = rankFormations(withBan, "points")[0];
    expect(best.eleven.map((p) => p.id)).not.toContain("banned");
  });

  it("breaks a tie on the name, so the eleven cannot wobble between renders", () => {
    const tied = [
      row("gk", { position: "Goalkeeper" }),
      ...[1, 2, 3].map((n) => row(`d${n}`, { position: "Defender" })),
      ...[1, 2, 3, 4].map((n) => row(`m${n}`, { position: "Midfielder" })),
      row("zed", { position: "Forward", seasonPoints: 5 }),
      row("abe", { position: "Forward", seasonPoints: 5 }),
      row("cid", { position: "Forward", seasonPoints: 5 }),
    ];
    const forwards = rankFormations(tied, "points")[0].eleven.filter(
      (p) => p.position === "Forward",
    );
    expect(forwards.map((p) => p.nickname)).toEqual(["abe", "cid", "zed"]);
  });

  it("sinks a player with no average rather than sorting them as zero", () => {
    // An unknown value is not a low one. A player who has never featured has no average
    // at all, and must never displace somebody who has.
    const rows = [
      row("gk", { position: "Goalkeeper" }),
      ...[1, 2, 3].map((n) => row(`d${n}`, { position: "Defender" })),
      ...[1, 2, 3, 4].map((n) => row(`m${n}`, { position: "Midfielder" })),
      row("never", {
        position: "Forward",
        averagePoints: null,
        seasonPoints: 0,
        gameweeksRecorded: 0,
      }),
      row("played", { position: "Forward", averagePoints: 0.1, seasonPoints: 1 }),
      row("also", { position: "Forward", averagePoints: 0.2, seasonPoints: 1 }),
    ];
    const forwards = rankFormations(rows, "average")[0].eleven.filter(
      (p) => p.position === "Forward",
    );
    expect(forwards.map((p) => p.id)).toEqual(["also", "played", "never"]);
  });

  it("returns all seven whatever the squad, so nothing vanishes silently", () => {
    expect(rankFormations([], "points")).toHaveLength(FORMATIONS.length);
  });

  it("does not disturb the caller's array", () => {
    const rows = [...full];
    rankFormations(rows, "points");
    expect(rows.map((r) => r.id)).toEqual(full.map((r) => r.id));
  });
});

describe("nearestFormation", () => {
  it("is the impossible one needing the fewest additions", () => {
    // What turns "no formation possible" into a transfer instruction.
    const thin = [
      row("gk", { position: "Goalkeeper" }),
      ...[1, 2, 3, 4, 5].map((n) => row(`d${n}`, { position: "Defender" })),
      row("m1", { position: "Midfielder" }),
      ...[1, 2, 3, 4].map((n) => row(`f${n}`, { position: "Forward" })),
    ];
    const nearest = nearestFormation(rankFormations(thin, "points"));
    // 5-3-2 needs two more midfielders; every other formation needs more than that.
    expect(nearest?.name).toBe("5-3-2");
    expect(nearest?.shortfall?.midfielders).toBe(2);
  });

  it("is null when some formation is actually possible", () => {
    const ranked = rankFormations(
      [
        row("gk", { position: "Goalkeeper" }),
        ...[1, 2, 3].map((n) => row(`d${n}`, { position: "Defender" })),
        ...[1, 2, 3, 4].map((n) => row(`m${n}`, { position: "Midfielder" })),
        ...[1, 2, 3].map((n) => row(`f${n}`, { position: "Forward" })),
      ],
      "points",
    );
    expect(nearestFormation(ranked)).toBeNull();
  });

  it("breaks a tie on the formation's own order, so it never wobbles", () => {
    const ranked = rankFormations([], "points");
    // An empty squad is equally far from several; the first in FORMATIONS order wins.
    expect(nearestFormation(ranked)?.name).toBe("5-4-1");
  });
});
