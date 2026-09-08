import { describe, expect, it } from "vitest";
import {
  holdings,
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
    // Ruling 3, the receiving side: a transfer IS an acquisition for its actor.
    const [holding] = holdings([
      op({ id: "in", activityType: 1, counterpartyManagerId: 2, occurredAt: at("2026-09-06T00:00:00Z") }),
      op({ id: "sell", activityType: 33, occurredAt: at("2026-09-07T00:00:00Z") }),
    ]);
    expect(holding.hours).toBe(24);
    expect(holding.breach).toBe(true);
  });

  it("never counts a clause raid against the manager who lost the player", () => {
    // Ruling 3, the other side, and the one that matters most: manager 2 bought the
    // player an hour before manager 1 paid the clause. Manager 2 did not sell — they
    // were raided — so no holding of theirs ends here, and nothing about them is a
    // breach. Counting it would point the public log at the victim.
    const result = holdings([
      op({ id: "buy2", activityType: 31, actorManagerId: 2, occurredAt: at("2026-09-01T10:00:00Z") }),
      op({ id: "raid", activityType: 1, actorManagerId: 1, counterpartyManagerId: 2, occurredAt: at("2026-09-01T11:00:00Z") }),
    ]);
    expect(result.filter((h) => h.managerId === 2)).toEqual([]);
    expect(result.filter((h) => h.breach)).toEqual([]);
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
