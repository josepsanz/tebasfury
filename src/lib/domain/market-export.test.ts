import { describe, expect, it } from "vitest";
import type { MarketOperation } from "./market";
import { MARKET_EXPORT_COLUMNS, marketCsv } from "./market-export";

const op = (over: Partial<MarketOperation> = {}): MarketOperation => ({
  id: "op1",
  activityType: 31,
  actorManagerId: 1,
  counterpartyManagerId: null,
  playerId: "p1",
  amount: 2_000_000,
  occurredAt: new Date("2026-09-01T12:00:00Z"),
  ...over,
});

const csv = (operations: MarketOperation[]) =>
  marketCsv({
    operations,
    managerNames: new Map([[1, "Ada"], [2, "Bruno"]]),
    playerNames: new Map([["p1", "Garcés, F."], ["p2", "Otxoa"]]),
  });

/** The data lines, without the byte order mark and the header. */
const records = (text: string) => text.replace(/^﻿/, "").trimEnd().split("\r\n").slice(1);

describe("marketCsv", () => {
  it("opens with a byte order mark and the header, and ends lines in CRLF", () => {
    const text = csv([]);
    expect(text).toBe(`﻿${MARKET_EXPORT_COLUMNS.join(",")}\r\n`);
  });

  it("writes operations oldest first, whatever order they arrive in", () => {
    const text = csv([
      op({ id: "late", occurredAt: new Date("2026-09-05T00:00:00Z") }),
      op({ id: "early", occurredAt: new Date("2026-09-01T00:00:00Z") }),
    ]);
    const [first, second] = records(text);
    expect(first.startsWith("early,")).toBe(true);
    expect(second.startsWith("late,")).toBe(true);
  });

  it("names both managers and the player, quoting a name with a comma", () => {
    const text = csv([op({ id: "raid", activityType: 1, actorManagerId: 2, counterpartyManagerId: 1 })]);
    expect(records(text)[0]).toBe(
      'raid,2026-09-01T12:00:00.000Z,transfer,1,2,Bruno,1,Ada,p1,"Garcés, F.",2000000,,,',
    );
  });

  it("gives a sale the holding it closed: hours, profit and the breach", () => {
    const text = csv([
      op({ id: "buy", amount: 2_000_000 }),
      op({ id: "sell", activityType: 33, amount: 3_000_000, occurredAt: new Date("2026-09-03T12:00:00Z") }),
    ]);
    expect(records(text)[1]).toBe(
      'sell,2026-09-03T12:00:00.000Z,sold,33,1,Ada,,,p1,"Garcés, F.",3000000,48,1000000,true',
    );
  });

  it("leaves a sale of unknown length blank rather than calling it clean", () => {
    const text = csv([op({ id: "sell", activityType: 33, playerId: "p2", amount: 1_000_000 })]);
    expect(records(text)[0]).toBe("sell,2026-09-01T12:00:00.000Z,sold,33,1,Ada,,,p2,Otxoa,1000000,,,");
  });
});
