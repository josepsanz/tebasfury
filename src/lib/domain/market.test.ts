import { describe, expect, it } from "vitest";
import {
  CLAUSE_PROTECTION_DAYS,
  clauseBoard,
  clauseStatus,
  fairPlayHold,
  holdings,
  marketSummary,
  operationKind,
  HOLD_HOURS,
  type MarketOperation,
} from "./market";

const at = (iso: string) => new Date(iso);

const op = (over: Partial<MarketOperation> = {}): MarketOperation => ({
  id: "op1",
  activityType: 31,
  actorManagerId: 1,
  counterpartyManagerId: null,
  playerId: "p1",
  amount: 1_000_000,
  occurredAt: at("2026-09-01T10:00:00Z"),
  ...over,
});

describe("operationKind", () => {
  it("names the three types the evidence settled", () => {
    expect(operationKind(31)).toBe("bought");
    expect(operationKind(33)).toBe("sold");
    expect(operationKind(1)).toBe("transfer");
  });

  it("calls everything else other, rather than guessing or throwing", () => {
    // The set is open: six types were observed and three could be named. Type 4 in
    // particular carries no amount and its players are usually still held, so calling
    // it a release would not produce a wrong number — it would accuse a person.
    expect(operationKind(4)).toBe("other");
    expect(operationKind(6)).toBe("other");
    expect(operationKind(77)).toBe("other");
  });
});

describe("holdings", () => {
  it("pairs a sale with the purchase that preceded it", () => {
    const [holding] = holdings([
      op({ id: "buy", activityType: 31, occurredAt: at("2026-09-01T10:00:00Z") }),
      op({ id: "sell", activityType: 33, occurredAt: at("2026-09-07T10:00:00Z") }),
    ]);
    expect(holding.hours).toBe(144);
    expect(holding.breach).toBe(false);
  });

  it("marks a sale inside the window as a breach", () => {
    const [holding] = holdings([
      op({ id: "buy", activityType: 31, occurredAt: at("2026-09-03T15:02:00Z") }),
      op({ id: "sell", activityType: 33, occurredAt: at("2026-09-07T14:59:00Z") }),
    ]);
    expect(holding.hours).toBe(95.95);
    expect(holding.breach).toBe(true);
  });

  it("treats exactly the threshold as kept, not broken", () => {
    // Ruling 4 is strict: bought at 17:02, sellable AT 17:02 five days later.
    const [holding] = holdings([
      op({ id: "buy", activityType: 31, occurredAt: at("2026-09-01T00:00:00Z") }),
      op({ id: "sell", activityType: 33, occurredAt: at("2026-09-06T00:00:00Z") }),
    ]);
    expect(holding.hours).toBe(HOLD_HOURS);
    expect(holding.breach).toBe(false);
  });

  it("starts the clock when a player arrives by clause", () => {
    // Ruling 3, the receiving side: a transfer IS an acquisition for its actor. Selected
    // by manager rather than taken as the first result, because the same transfer now
    // also closes the COUNTERPARTY's holding — see the test below.
    const holding = holdings([
      op({ id: "in", activityType: 1, counterpartyManagerId: 2, occurredAt: at("2026-09-06T00:00:00Z") }),
      op({ id: "sell", activityType: 33, occurredAt: at("2026-09-07T00:00:00Z") }),
    ]).find((h) => h.managerId === 1 && h.voluntary);
    expect(holding?.hours).toBe(24);
    expect(holding?.breach).toBe(true);
  });

  it("never counts a clause raid against the manager who lost the player", () => {
    // Ruling 3, the other side. They did not sell — they were raided — so this can never
    // be a breach; counting it would point the public log at the victim.
    //
    // **The input here cannot occur in the real game**, and that is deliberate: a bought
    // player carries 14 days of anti-clause protection, so a raid can never land inside
    // the five-day window at all. This asserts the guard holds anyway, because the rule
    // should not depend on a league setting this code cannot see and does not read.
    //
    // The holding IS now reported, which it was not before: the raid moved real money and
    // the money view needs it. `voluntary` is what keeps the two apart, and `breach` is
    // the assertion that matters — false even with the player held one hour.
    const result = holdings([
      op({ id: "buy2", activityType: 31, actorManagerId: 2, occurredAt: at("2026-09-01T10:00:00Z") }),
      op({ id: "raid", activityType: 1, actorManagerId: 1, counterpartyManagerId: 2, occurredAt: at("2026-09-01T11:00:00Z") }),
    ]);
    expect(result.filter((h) => h.breach)).toEqual([]);

    const raided = result.find((h) => h.managerId === 2);
    expect(raided).toMatchObject({ voluntary: false, breach: false, hours: 1 });
  });

  it("reports an unknown holding period when the purchase predates the log", () => {
    // Ruling 5. In the first week after deployment this is most of the feed, and it is
    // neither a breach nor a clean record: nobody knows how long they held them.
    const [holding] = holdings([op({ id: "sell", activityType: 33, occurredAt: at("2026-09-07T10:00:00Z") })]);
    expect(holding.acquiredAt).toBeNull();
    expect(holding.hours).toBeNull();
    expect(holding.breach).toBe(false);
  });

  it("pairs a re-bought player with the most recent purchase, not the first", () => {
    const result = holdings([
      op({ id: "buy1", activityType: 31, occurredAt: at("2026-09-01T00:00:00Z") }),
      op({ id: "sell1", activityType: 33, occurredAt: at("2026-09-04T00:00:00Z") }),
      op({ id: "buy2", activityType: 31, occurredAt: at("2026-09-05T00:00:00Z") }),
      op({ id: "sell2", activityType: 33, occurredAt: at("2026-09-05T12:00:00Z") }),
    ]);
    expect(result.map((h) => h.hours)).toEqual([72, 12]);
    expect(result.map((h) => h.breach)).toEqual([true, true]);
  });

  it("keeps two managers' holdings of the same player apart", () => {
    // The key must include both manager and player. Without it, manager 1's initial
    // purchase gets overwritten by manager 2's, and manager 1's sale gets paired with
    // manager 2's purchase date, creating a false 24-hour breach instead of 7 days.
    const result = holdings([
      op({ id: "a-buy", activityType: 31, actorManagerId: 1, occurredAt: at("2026-09-01T00:00:00Z") }),
      op({ id: "b-buy", activityType: 31, actorManagerId: 2, occurredAt: at("2026-09-06T00:00:00Z") }),
      op({ id: "b-sell", activityType: 33, actorManagerId: 2, occurredAt: at("2026-09-07T00:00:00Z") }),
      op({ id: "a-sell", activityType: 33, actorManagerId: 1, occurredAt: at("2026-09-08T00:00:00Z") }),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ managerId: 2, hours: 24, breach: true });
    expect(result[1]).toMatchObject({ managerId: 1, hours: 168, breach: false });
  });

  it("ignores the types it cannot name", () => {
    const result = holdings([
      op({ id: "buy", activityType: 31, occurredAt: at("2026-09-01T00:00:00Z") }),
      op({ id: "mystery", activityType: 4, occurredAt: at("2026-09-02T00:00:00Z") }),
      op({ id: "sell", activityType: 33, occurredAt: at("2026-09-07T00:00:00Z") }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].hours).toBe(144);
  });
});

describe("marketSummary", () => {
  const ME = 1;
  const THEM = 2;
  const empty = { count: 0, total: 0, average: null, biggest: null };

  it("adds up what a manager spent on and took from the market", () => {
    const summary = marketSummary(
      [
        op({ id: "b1", activityType: 31, actorManagerId: ME, amount: 3_000_000 }),
        op({ id: "b2", activityType: 31, actorManagerId: ME, amount: 1_000_000 }),
        op({ id: "s1", activityType: 33, actorManagerId: ME, amount: 5_000_000 }),
      ],
      ME,
    );
    expect(summary.bought).toMatchObject({ count: 2, total: 4_000_000, average: 2_000_000 });
    expect(summary.sold).toMatchObject({ count: 1, total: 5_000_000, average: 5_000_000 });
  });

  it("names the biggest buy and the biggest sale, with the player", () => {
    const summary = marketSummary(
      [
        op({ id: "b1", activityType: 31, actorManagerId: ME, playerId: "small", amount: 1_000_000 }),
        op({ id: "b2", activityType: 31, actorManagerId: ME, playerId: "big", amount: 8_000_000 }),
        op({ id: "s1", activityType: 33, actorManagerId: ME, playerId: "gone", amount: 2_000_000 }),
      ],
      ME,
    );
    expect(summary.bought.biggest).toEqual({ playerId: "big", amount: 8_000_000 });
    expect(summary.sold.biggest).toEqual({ playerId: "gone", amount: 2_000_000 });
  });

  it("keeps a clause paid out of buys, on its own side", () => {
    const summary = marketSummary(
      [op({ id: "t", activityType: 1, actorManagerId: ME, counterpartyManagerId: THEM, amount: 7_000_000 })],
      ME,
    );
    expect(summary.clausesPaid).toMatchObject({ count: 1, total: 7_000_000 });
    expect(summary.bought).toEqual(empty);
    expect(summary.sold).toEqual(empty);
  });

  it("does NOT count being clause-raided as a sale", () => {
    // The distinction this shape exists for. Money came in, but they did not choose to
    // sell — the same refusal `holdings` makes, so both now use the word the same way.
    const summary = marketSummary(
      [op({ id: "t", activityType: 1, actorManagerId: THEM, counterpartyManagerId: ME, amount: 7_000_000 })],
      ME,
    );
    expect(summary.clausesCharged).toMatchObject({ count: 1, total: 7_000_000 });
    expect(summary.sold).toEqual(empty);
    expect(summary.bought).toEqual(empty);
  });

  it("gives clauses the same three figures the market sides get", () => {
    const summary = marketSummary(
      [
        op({ id: "t1", activityType: 1, actorManagerId: ME, counterpartyManagerId: THEM, playerId: "a", amount: 2_000_000 }),
        op({ id: "t2", activityType: 1, actorManagerId: ME, counterpartyManagerId: THEM, playerId: "b", amount: 6_000_000 }),
      ],
      ME,
    );
    expect(summary.clausesPaid).toEqual({
      count: 2,
      total: 8_000_000,
      average: 4_000_000,
      biggest: { playerId: "b", amount: 6_000_000 },
    });
  });

  it("aggregates all four sides into cash in, cash out and the difference", () => {
    const summary = marketSummary(
      [
        op({ id: "b", activityType: 31, actorManagerId: ME, amount: 10_000_000 }),
        op({ id: "s", activityType: 33, actorManagerId: ME, amount: 4_000_000 }),
        op({ id: "cp", activityType: 1, actorManagerId: ME, counterpartyManagerId: THEM, amount: 5_000_000 }),
        op({ id: "cc", activityType: 1, actorManagerId: THEM, counterpartyManagerId: ME, amount: 3_000_000 }),
      ],
      ME,
    );
    expect(summary.cashIn).toBe(7_000_000); // sold 4 + charged 3
    expect(summary.cashOut).toBe(15_000_000); // bought 10 + paid 5
    expect(summary.difference).toBe(-8_000_000);
  });

  it("ignores other managers' dealings entirely", () => {
    const summary = marketSummary(
      [op({ id: "b", activityType: 31, actorManagerId: THEM, amount: 9_000_000 })],
      ME,
    );
    expect(summary).toEqual({
      bought: empty,
      sold: empty,
      clausesPaid: empty,
      clausesCharged: empty,
      cashIn: 0,
      cashOut: 0,
      difference: 0,
    });
  });

  it("ignores the types that carry no price, and the one we cannot name", () => {
    // Types 4, 7 and 9 have no amount in any row measured. Type 6 has one but is `other`,
    // and pricing an operation we cannot name would put a number behind a guess.
    const summary = marketSummary(
      [
        op({ id: "x", activityType: 4, actorManagerId: ME, amount: null }),
        op({ id: "y", activityType: 9, actorManagerId: ME, amount: null }),
        op({ id: "z", activityType: 6, actorManagerId: ME, amount: 4_000_000 }),
      ],
      ME,
    );
    expect(summary.cashIn).toBe(0);
    expect(summary.cashOut).toBe(0);
  });

  it("leaves an average unknown rather than nought when nothing was traded", () => {
    // A mean of no operations is not zero, and a zero here would read as "bought a player
    // for nothing" rather than "bought nobody".
    expect(marketSummary([], ME).bought.average).toBeNull();
  });

  it("rounds an average to whole money, since that is what the page prints", () => {
    const summary = marketSummary(
      [
        op({ id: "b1", activityType: 31, actorManagerId: ME, amount: 1_000_000 }),
        op({ id: "b2", activityType: 31, actorManagerId: ME, amount: 1_000_001 }),
        op({ id: "b3", activityType: 31, actorManagerId: ME, amount: 1_000_001 }),
      ],
      ME,
    );
    expect(Number.isInteger(summary.bought.average)).toBe(true);
  });
});

describe("holdings, what a player made or lost", () => {
  const bought = (amount: number | null, when: string) =>
    op({ id: `b-${when}`, activityType: 31, amount, occurredAt: at(when) });
  const sold = (amount: number | null, when: string) =>
    op({ id: `s-${when}`, activityType: 33, amount, occurredAt: at(when) });

  it("prices a sale against what the player actually cost", () => {
    const [holding] = holdings([
      bought(2_000_000, "2026-09-01T10:00:00Z"),
      sold(5_000_000, "2026-09-08T10:00:00Z"),
    ]);
    expect(holding).toMatchObject({
      acquiredFor: 2_000_000,
      releasedFor: 5_000_000,
      profit: 3_000_000,
    });
  });

  it("reports a loss as a negative, not as an absence", () => {
    const [holding] = holdings([
      bought(9_000_000, "2026-09-01T10:00:00Z"),
      sold(4_000_000, "2026-09-08T10:00:00Z"),
    ]);
    expect(holding.profit).toBe(-5_000_000);
  });

  it("leaves the profit UNKNOWN when the purchase predates the log", () => {
    // The distinction the whole field exists for: calling an unknowable profit nought
    // would report a manager who doubled their money as having broken even. Same refusal
    // `hours` already makes about a period it cannot measure.
    const [holding] = holdings([sold(5_000_000, "2026-09-08T10:00:00Z")]);
    expect(holding).toMatchObject({ acquiredAt: null, acquiredFor: null, profit: null });
  });

  it("prices a clause-bought player against the clause, not against nothing", () => {
    // A transfer in is an acquisition too, and it always carries an amount.
    const [holding] = holdings([
      op({ id: "t", activityType: 1, amount: 7_000_000, occurredAt: at("2026-09-01T10:00:00Z") }),
      sold(9_000_000, "2026-09-08T10:00:00Z"),
    ]);
    expect(holding.profit).toBe(2_000_000);
  });

  it("prices the SECOND holding against the second purchase, not the first", () => {
    // A manager who buys, sells and re-buys has two independent holdings; pairing the
    // second sale with the first purchase would invent a profit that never happened.
    const all = holdings([
      bought(1_000_000, "2026-09-01T10:00:00Z"),
      sold(2_000_000, "2026-09-02T10:00:00Z"),
      bought(8_000_000, "2026-09-03T10:00:00Z"),
      sold(9_000_000, "2026-09-04T10:00:00Z"),
    ]);
    expect(all.map((h) => h.profit)).toEqual([1_000_000, 1_000_000]);
  });

  it("is unknown when a purchase carried no price", () => {
    const [holding] = holdings([
      bought(null, "2026-09-01T10:00:00Z"),
      sold(5_000_000, "2026-09-08T10:00:00Z"),
    ]);
    expect(holding.profit).toBeNull();
  });

  it("breaks even at exactly zero, which is a number and not an absence", () => {
    const [holding] = holdings([
      bought(3_000_000, "2026-09-01T10:00:00Z"),
      sold(3_000_000, "2026-09-08T10:00:00Z"),
    ]);
    expect(holding.profit).toBe(0);
  });
});

describe("clauseBoard", () => {
  const now = at("2026-09-09T12:00:00Z");
  const held = (playerId: string, managerId: number, lock: string | null, shielded = false) => ({
    playerId,
    managerId,
    clauseLockedUntil: lock === null ? null : at(lock),
    shielded,
  });

  it("puts the takeable first, then the soonest to free up", () => {
    // A player you can take today outranks one you can take on Friday.
    const board = clauseBoard(
      [
        held("locked-late", 1, "2026-09-22T10:00:00Z"),
        held("free", 1, null),
        held("locked-soon", 2, "2026-09-10T10:00:00Z"),
      ],
      now,
    );
    expect(board.map((r) => r.playerId)).toEqual(["free", "locked-soon", "locked-late"]);
  });

  it("treats a lock that has already lifted as free", () => {
    const board = clauseBoard([held("lapsed", 1, "2026-09-08T10:00:00Z")], now);
    expect(board[0].protectedUntil).toBeNull();
  });

  it("never calls a shielded player free, whatever their lock says", () => {
    // The shield is a separate block; offering somebody who cannot be taken is the one
    // thing this board must not do.
    const board = clauseBoard(
      [held("shielded", 1, null, true), held("open", 2, null)],
      now,
    );
    expect(board.map((r) => r.playerId)).toEqual(["open", "shielded"]);
    expect(board.find((r) => r.playerId === "shielded")?.shielded).toBe(true);
  });

  it("sorts a bare shield after every dated lock, having no date to count down to", () => {
    const board = clauseBoard(
      [held("shielded", 1, null, true), held("dated", 2, "2026-09-30T10:00:00Z")],
      now,
    );
    expect(board.map((r) => r.playerId)).toEqual(["dated", "shielded"]);
  });

  it("carries the moment each lock lifts", () => {
    const board = clauseBoard([held("a", 1, "2026-09-10T10:00:00Z")], now);
    expect(board[0].protectedUntil).toEqual(at("2026-09-10T10:00:00Z"));
  });

  it("keeps the owner, because the point is knowing who to raid", () => {
    expect(clauseBoard([held("a", 7, null)], now)[0].managerId).toBe(7);
  });

  it("is empty for an empty squad", () => {
    expect(clauseBoard([], now)).toEqual([]);
  });

  it("does not disturb the caller's array", () => {
    const rows = [held("a", 1, null), held("b", 2, "2026-09-20T10:00:00Z")];
    const before = rows.map((r) => r.playerId);
    clauseBoard(rows, now);
    expect(rows.map((r) => r.playerId)).toEqual(before);
  });
});

describe("clauseStatus", () => {
  const now = at("2026-09-09T12:00:00Z");

  it("calls an unprotected player takeable", () => {
    expect(clauseStatus({ lockedUntil: null, shielded: false }, now)).toEqual({
      state: "takeable",
      label: "takeable",
      shielded: false,
    });
  });

  it("counts a lock that has already lifted as takeable, not as locked", () => {
    expect(clauseStatus({ lockedUntil: at("2026-09-09T11:00:00Z"), shielded: false }, now).state).toBe("takeable");
  });

  it("treats the exact instant of lifting as lifted", () => {
    expect(clauseStatus({ lockedUntil: now, shielded: false }, now).state).toBe("takeable");
  });

  it("says how many hours are left inside the last day", () => {
    // A day is the unit a manager acts on: a lock lifting tonight is worth waiting up
    // for, one lifting on Friday is a note in the calendar.
    expect(clauseStatus({ lockedUntil: at("2026-09-09T20:00:00Z"), shielded: false }, now)).toEqual({
      state: "soon",
      label: "free in 8 hours",
      shielded: false,
    });
  });

  it("says one hour, not 1 hours", () => {
    expect(clauseStatus({ lockedUntil: at("2026-09-09T13:00:00Z"), shielded: false }, now).label).toBe("free in 1 hour");
  });

  it("never rounds the last minutes down to zero hours", () => {
    // "free in 0 hours" reads as a bug; the player is still locked.
    const status = clauseStatus({ lockedUntil: at("2026-09-09T12:10:00Z"), shielded: false }, now);
    expect(status.state).toBe("soon");
    expect(status.label).toBe("free in 1 hour");
  });

  it("is locked, with a date, beyond a day", () => {
    expect(clauseStatus({ lockedUntil: at("2026-09-14T12:00:00Z"), shielded: false }, now)).toEqual({
      state: "locked",
      label: "locked until 14 Sept",
      shielded: false,
    });
  });

  it("puts the boundary at exactly a day on the locked side", () => {
    expect(clauseStatus({ lockedUntil: at("2026-09-10T12:00:00Z"), shielded: false }, now).state).toBe("locked");
    expect(clauseStatus({ lockedUntil: at("2026-09-10T11:59:00Z"), shielded: false }, now).state).toBe("soon");
  });

  it("dates the lock in the league's own timezone, not the machine's", () => {
    // 23:30 UTC is already the next day in Madrid, and the reader lives in Madrid.
    expect(clauseStatus({ lockedUntil: at("2026-09-14T23:30:00Z"), shielded: false }, now).label).toBe("locked until 15 Sept");
  });
});

describe("the league's clause rule", () => {
  it("is fourteen days, recorded even though nothing computes with it any more", () => {
    // The lock is READ from the API now, not derived. The constant stays because it is
    // the rule the owner told us and the reason `buyoutClauseLockedEndTime` says what it
    // says — and because if the API ever stops carrying that field, this is the number
    // the portal would have to fall back to deriving from.
    expect(CLAUSE_PROTECTION_DAYS).toBe(14);
  });
});

describe("clauseStatus and the shield", () => {
  const now = at("2026-09-09T12:00:00Z");

  it("calls an unlocked, unshielded player takeable", () => {
    expect(clauseStatus({ lockedUntil: null, shielded: false }, now)).toEqual({
      state: "takeable",
      label: "takeable",
      shielded: false,
    });
  });

  it("is shielded, not takeable, once the lock has lapsed but the shield stands", () => {
    // The shield is a separate 24-hour block. Calling this player takeable would offer
    // somebody who cannot actually be taken.
    expect(clauseStatus({ lockedUntil: at("2026-09-08T10:00:00Z"), shielded: true }, now)).toEqual({
      state: "shielded",
      label: "shielded",
      shielded: true,
    });
  });

  it("shows the dated lock when both are running, and still flags the shield", () => {
    // A date can be counted down to; a shield cannot, because the response carries no
    // expiry for it. So the date leads and the shield rides along as its own mark.
    const status = clauseStatus({ lockedUntil: at("2026-09-20T10:00:00Z"), shielded: true }, now);
    expect(status.state).toBe("locked");
    expect(status.shielded).toBe(true);
  });

  it("counts down a shielded player's lock in hours like any other", () => {
    const status = clauseStatus({ lockedUntil: at("2026-09-09T20:00:00Z"), shielded: true }, now);
    expect(status).toMatchObject({ state: "soon", label: "free in 8 hours", shielded: true });
  });

  it("never counts down the shield itself, having no expiry to count to", () => {
    const status = clauseStatus({ lockedUntil: null, shielded: true }, now);
    expect(status.label).toBe("shielded");
    expect(status.label).not.toMatch(/hour|until/);
  });
});

describe("fairPlayHold", () => {
  const at = (iso: string) => new Date(iso);

  it("lifts five days after the purchase the clause lock dates", () => {
    // Bought 2026-09-01T12:00Z, so the lock ends fourteen days later and the hold five.
    const lock = at("2026-09-15T12:00:00Z");
    expect(fairPlayHold(lock, at("2026-09-02T12:00:00Z"))).toEqual(at("2026-09-06T12:00:00Z"));
  });

  it("is over once the fifth day has passed, long before the clause lock ends", () => {
    const lock = at("2026-09-15T12:00:00Z");
    // Day six: still unraidable for another eight days, but sellable.
    expect(fairPlayHold(lock, at("2026-09-07T12:00:00Z"))).toBeNull();
  });

  it("holds right up to the instant it lifts, and not past it", () => {
    const lock = at("2026-09-15T12:00:00Z");
    expect(fairPlayHold(lock, at("2026-09-06T11:59:59Z"))).not.toBeNull();
    expect(fairPlayHold(lock, at("2026-09-06T12:00:00Z"))).toBeNull();
  });

  it("says nothing about a player the API gave no lock for", () => {
    expect(fairPlayHold(null, at("2026-09-02T12:00:00Z"))).toBeNull();
  });

  it("is always inside the clause lock, so a held player is a locked one", () => {
    // The property the icon depends on: it never has to stand alone on a green name.
    const lock = at("2026-09-15T12:00:00Z");
    const now = at("2026-09-03T12:00:00Z");
    expect(fairPlayHold(lock, now)).not.toBeNull();
    expect(clauseStatus({ lockedUntil: lock, shielded: false }, now).state).toBe("locked");
  });
});
