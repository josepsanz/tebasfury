import { describe, expect, it } from "vitest";
import {
  buildTargets,
  daysBefore,
  isMarketStale,
  marketLine,
  parseTargetView,
  rankTargets,
  toTarget,
  type TargetInput,
} from "./targets";

const now = new Date("2026-10-03T18:00:00Z");
const later = new Date("2026-10-04T17:00:00Z");
const past = new Date("2026-10-03T17:00:00Z");

const input = (over: Partial<TargetInput> = {}): TargetInput => ({
  playerId: "p1",
  nickname: "Player",
  position: "Midfielder",
  status: "ok",
  value: 10_000_000,
  value7DaysAgo: 10_000_000,
  value14DaysAgo: 10_000_000,
  owner: null,
  listing: null,
  points: [],
  ...over,
});

const owner = (over: Partial<NonNullable<TargetInput["owner"]>> = {}): NonNullable<TargetInput["owner"]> => ({
  teamId: "t2",
  managerName: "Bruno",
  buyoutClause: 12_000_000,
  clauseLockedUntil: null,
  shielded: false,
  ...over,
});

const tags = (i: TargetInput) => toTarget(i, now).tags.map((t) => t.key);

describe("daysBefore", () => {
  it("counts calendar days across a month boundary", () => {
    expect(daysBefore("2026-10-03", 7)).toBe("2026-09-26");
    expect(daysBefore("2026-03-01", 14)).toBe("2026-02-15");
  });
});

describe("routes and cost", () => {
  it("prices an auction at market value", () => {
    const t = toTarget(input({ listing: { kind: "league", expiresAt: later, bids: 0 } }), now);
    expect(t).toMatchObject({ route: "auction", cost: 10_000_000, costMultiple: 1 });
  });

  it("prices a manager's listing at value plus the house rule's ten per cent", () => {
    const t = toTarget(input({ owner: owner({ clauseLockedUntil: later }), listing: { kind: "team", expiresAt: later, bids: null } }), now);
    expect(t.route).toBe("listed");
    expect(t.cost).toBeCloseTo(11_000_000, 0);
  });

  it("prices an unlocked owned player at the clause", () => {
    expect(toTarget(input({ owner: owner() }), now)).toMatchObject({ route: "clause", cost: 12_000_000 });
  });

  it("takes the cheaper route when a listed player is also clausable", () => {
    const t = toTarget(input({ owner: owner({ buyoutClause: 10_500_000 }), listing: { kind: "team", expiresAt: later, bids: null } }), now);
    expect(t).toMatchObject({ route: "clause", cost: 10_500_000 });
  });

  it("gives a tie between a listing and a clause to the clause", () => {
    const t = toTarget(
      input({ value: 1_320_000, owner: owner({ buyoutClause: 1_452_000 }), listing: { kind: "team", expiresAt: later, bids: null } }),
      now,
    );
    expect(t).toMatchObject({ route: "clause", cost: 1_452_000 });
    expect(t.tags.map((x) => x.key)).toContain("cheap-clause");
  });

  it("opens no route at a cost of zero", () => {
    expect(toTarget(input({ owner: owner({ buyoutClause: 0 }) }), now).route).toBeNull();
  });

  it("opens no clause route while locked or shielded", () => {
    expect(toTarget(input({ owner: owner({ clauseLockedUntil: later }) }), now).route).toBeNull();
    expect(toTarget(input({ owner: owner({ shielded: true }) }), now).route).toBeNull();
  });

  it("opens no route on a listing that has already expired", () => {
    expect(toTarget(input({ listing: { kind: "league", expiresAt: past, bids: 0 } }), now).route).toBeNull();
    expect(toTarget(input({ owner: owner({ clauseLockedUntil: later }), listing: { kind: "team", expiresAt: past, bids: null } }), now).route).toBeNull();
  });

  it("opens no route without a clause figure or a value", () => {
    expect(toTarget(input({ owner: owner({ buyoutClause: null }) }), now).route).toBeNull();
    expect(toTarget(input({ value: null, listing: { kind: "league", expiresAt: later, bids: 0 } }), now).route).toBeNull();
  });
});

describe("scores", () => {
  it("projects a week's growth onto the real cost", () => {
    // +20% a week, bought at 1.10x: 12M / 11M - 1 = +9.09%.
    const t = toTarget(
      input({ value7DaysAgo: 8_333_334, owner: owner({ clauseLockedUntil: later }), listing: { kind: "team", expiresAt: later, bids: null } }),
      now,
    );
    expect(t.growth7).toBeCloseTo(0.2, 3);
    expect(t.investment).toBeCloseTo(0.0909, 3);
  });

  it("states the week's growth in money per day, over the same seven days as the percentage", () => {
    // 10M against 9.3M a week ago: +700K over seven days is +100K a day.
    const t = toTarget(input({ value7DaysAgo: 9_300_000, listing: { kind: "league", expiresAt: later, bids: 0 } }), now);
    expect(t.gainPerDay7).toBeCloseTo(100_000, 6);
    // Falling is negative, not hidden.
    expect(toTarget(input({ value7DaysAgo: 10_700_000 }), now).gainPerDay7).toBeCloseTo(-100_000, 6);
  });

  it("has no money-per-day figure without the snapshot a week ago", () => {
    expect(toTarget(input({ value7DaysAgo: null }), now).gainPerDay7).toBeNull();
    expect(toTarget(input({ value: null }), now).gainPerDay7).toBeNull();
  });

  it("has no investment score without seven days of history", () => {
    const t = toTarget(input({ value7DaysAgo: null, listing: { kind: "league", expiresAt: later, bids: 0 } }), now);
    expect(t.growth7).toBeNull();
    expect(t.investment).toBeNull();
  });

  it("scores performance as recent form per million of cost", () => {
    const t = toTarget(input({ points: [9, 6, 3, 0, 0], listing: { kind: "league", expiresAt: later, bids: 0 } }), now);
    expect(t.form).toBe(6);
    expect(t.seasonAverage).toBeCloseTo(3.6, 5);
    expect(t.performance).toBeCloseTo(0.6, 5);
  });

  it("has no form below three recorded rounds", () => {
    const t = toTarget(input({ points: [9, 6], listing: { kind: "league", expiresAt: later, bids: 0 } }), now);
    expect(t.form).toBeNull();
    expect(t.performance).toBeNull();
  });

  it("has no score at all without an open route", () => {
    const t = toTarget(input({ points: [5, 5, 5], owner: owner({ clauseLockedUntil: later }) }), now);
    expect(t.investment).toBeNull();
    expect(t.performance).toBeNull();
  });
});

describe("tags", () => {
  const auction = { kind: "league" as const, expiresAt: later, bids: 2 };

  it("calls eighteen per cent a week rising fast, and a hair under it not", () => {
    expect(tags(input({ value: 11_800_000, listing: auction }))).toContain("rising-fast");
    expect(tags(input({ value: 11_799_000, listing: auction }))).not.toContain("rising-fast");
  });

  it("calls a nine per cent drop falling, and a hair less not", () => {
    expect(tags(input({ value: 9_100_000, listing: auction }))).toContain("falling");
    expect(tags(input({ value: 9_101_000, listing: auction }))).not.toContain("falling");
  });

  it("calls a climb steady only when both a week and a fortnight are up", () => {
    expect(tags(input({ value: 10_100_000, listing: auction }))).toContain("steady-climb");
    expect(tags(input({ value: 10_100_000, value14DaysAgo: 10_200_000, listing: auction }))).not.toContain("steady-climb");
    expect(tags(input({ value: 10_100_000, value14DaysAgo: null, listing: auction }))).not.toContain("steady-climb");
  });

  it("calls a clause at up to 1.10x value cheap", () => {
    expect(tags(input({ owner: owner({ buyoutClause: 11_000_000 }) }))).toContain("cheap-clause");
    expect(tags(input({ owner: owner({ buyoutClause: 11_001_000 }) }))).not.toContain("cheap-clause");
  });

  it("marks a lock lifting within a day, but not behind a shield", () => {
    const soon = new Date(now.getTime() + 6 * 60 * 60 * 1000);
    expect(tags(input({ owner: owner({ clauseLockedUntil: soon }) }))).toContain("takeable-soon");
    expect(tags(input({ owner: owner({ clauseLockedUntil: soon, shielded: true }) }))).not.toContain("takeable-soon");
  });

  it("calls form two points over the season average in form", () => {
    // form 6, season (6+6+6+0+2)/5 = 4: exactly +2.
    expect(tags(input({ points: [6, 6, 6, 0, 2], listing: auction }))).toContain("in-form");
    expect(tags(input({ points: [6, 6, 6, 0, 3], listing: auction }))).not.toContain("in-form");
  });

  it("marks an auction nobody has bid on", () => {
    expect(tags(input({ listing: { ...auction, bids: 0 } }))).toContain("no-bids");
    expect(tags(input({ listing: auction }))).not.toContain("no-bids");
  });

  it("warns of injury, doubt and suspension", () => {
    expect(tags(input({ status: "injured", listing: auction }))).toContain("injured");
    expect(tags(input({ status: "doubtful", listing: auction }))).toContain("doubtful");
    expect(tags(input({ status: "suspended", listing: auction }))).toContain("suspended");
  });
});

describe("buildTargets", () => {
  const auction = { kind: "league" as const, expiresAt: later, bids: 0 };

  it("never ranks the reader's own players", () => {
    const board = buildTargets([input({ playerId: "mine", owner: owner({ teamId: "t1" }) }), input({ playerId: "theirs", owner: owner() })], { now, readerTeamId: "t1" });
    expect(board.ranked.map((t) => t.playerId)).toEqual(["theirs"]);
    expect(board.locked).toEqual([]);
  });

  it("excludes nobody for a reader with no team", () => {
    const board = buildTargets([input({ playerId: "a", owner: owner({ teamId: "t1" }) })], { now, readerTeamId: null });
    expect(board.ranked).toHaveLength(1);
  });

  it("puts an owned player with no open route in the locked group, soonest first", () => {
    const sooner = new Date(now.getTime() + 2 * 86_400_000);
    const board = buildTargets(
      [
        input({ playerId: "late", owner: owner({ clauseLockedUntil: later }) }),
        input({ playerId: "far", owner: owner({ clauseLockedUntil: new Date(now.getTime() + 9 * 86_400_000) }) }),
        input({ playerId: "near", owner: owner({ clauseLockedUntil: sooner }) }),
      ],
      { now, readerTeamId: null },
    );
    expect(board.ranked).toEqual([]);
    expect(board.locked.map((t) => t.playerId)).toEqual(["late", "near", "far"]);
  });

  it("drops a free agent whose auction has closed: there is nothing to buy", () => {
    const board = buildTargets([input({ listing: { ...auction, expiresAt: past } })], { now, readerTeamId: null });
    expect(board).toEqual({ ranked: [], locked: [] });
  });
});

describe("rankTargets", () => {
  const auction = { kind: "league" as const, expiresAt: later, bids: 0 };
  const view = parseTargetView({});
  const build = (inputs: TargetInput[]) => buildTargets(inputs, { now, readerTeamId: null }).ranked;

  it("orders by the active lens, unscored rows last", () => {
    const rows = build([
      input({ playerId: "flat", nickname: "Flat", listing: auction }),
      input({ playerId: "none", nickname: "None", value7DaysAgo: null, listing: auction }),
      input({ playerId: "up", nickname: "Up", value: 11_000_000, listing: auction }),
    ]);
    expect(rankTargets(rows, view).map((t) => t.playerId)).toEqual(["up", "flat", "none"]);
  });

  it("filters by route, position and injury", () => {
    const rows = build([
      input({ playerId: "a", listing: auction }),
      input({ playerId: "c", owner: owner(), position: "Forward" }),
      input({ playerId: "i", status: "injured", listing: auction }),
      input({ playerId: "d", status: "doubtful", listing: auction }),
    ]);
    expect(rankTargets(rows, { ...view, route: "clause" }).map((t) => t.playerId)).toEqual(["c"]);
    expect(rankTargets(rows, { ...view, position: "Forward" }).map((t) => t.playerId)).toEqual(["c"]);
    const ids = rankTargets(rows, view).map((t) => t.playerId);
    expect(ids).not.toContain("i");
    expect(ids).toContain("d");
    expect(rankTargets(rows, { ...view, showInjured: true }).map((t) => t.playerId)).toContain("i");
  });
});

describe("parseTargetView", () => {
  it("defaults to investment, every route, every position, injuries hidden", () => {
    expect(parseTargetView({})).toEqual({ lens: "investment", route: "all", position: null, showInjured: false });
  });

  it("reads each parameter and ignores nonsense", () => {
    expect(parseTargetView({ lens: "performance", route: "clause", position: "Forward", injured: "shown" })).toEqual({
      lens: "performance",
      route: "clause",
      position: "Forward",
      showInjured: true,
    });
    expect(parseTargetView({ position: "" }).position).toBeNull();
    expect(parseTargetView({ lens: "x", route: ["a", "b"] })).toMatchObject({ lens: "investment", route: "all" });
  });
});

describe("isMarketStale", () => {
  it("is stale when never read or read more than a day ago", () => {
    expect(isMarketStale(null, now)).toBe(true);
    expect(isMarketStale(new Date(now.getTime() - 86_400_001), now)).toBe(true);
    expect(isMarketStale(new Date(now.getTime() - 60_000), now)).toBe(false);
  });
});

describe("marketLine", () => {
  // `now` is 20:00 in Madrid; the auction closes at 19:00 and the next sweep is 19:45.
  const readThisMorning = new Date("2026-10-03T11:45:00Z");

  it("says the market was never read, in the alert colour", () => {
    expect(marketLine(null, null, now)).toEqual({
      text: "The market has not been read yet, so only clause routes are ranked.",
      stale: true,
    });
  });

  it("calls a read over a day old stale, and says expired listings are left out", () => {
    const line = marketLine(new Date(now.getTime() - 86_400_001), past, now);
    expect(line.stale).toBe(true);
    expect(line.text).toMatch(/^Market read .*, over a day old\. Expired listings are left out\.$/);
  });

  it("names when an open auction closes", () => {
    expect(marketLine(readThisMorning, later, now)).toEqual({
      text: "Market read 13:45 · auction closes Sun 04 Oct, 19:00",
      stale: false,
    });
  });

  it("says when today's auction has already closed, without calling the read stale", () => {
    expect(marketLine(readThisMorning, past, now)).toEqual({
      text: "Market read 13:45 · today's auction closed Sat 03 Oct, 19:00, the new one is read at the next sweep",
      stale: false,
    });
  });

  it("says only when the market was read when no auction is known", () => {
    expect(marketLine(readThisMorning, null, now)).toEqual({ text: "Market read 13:45", stale: false });
  });
});
