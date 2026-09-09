import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { marketSummary, type MarketOperation } from "@/lib/domain/market";
import { MarketMoney } from "./market-money";

const ME = 1;
const THEM = 2;

const op = (over: Partial<MarketOperation> = {}): MarketOperation => ({
  id: "op1",
  activityType: 31,
  actorManagerId: ME,
  counterpartyManagerId: null,
  playerId: "p1",
  amount: 1_000_000,
  occurredAt: new Date("2026-09-01T10:00:00Z"),
  ...over,
});

const names = new Map([["p1", "F. Garcés"], ["p2", "Otxoa"]]);
const render = (operations: MarketOperation[]) =>
  renderToStaticMarkup(
    <MarketMoney summary={marketSummary(operations, ME)} nameOf={(id) => names.get(id)} />,
  );

describe("MarketMoney", () => {
  it("gives clauses their own two rows, apart from buying and selling", () => {
    const html = render([]);
    for (const label of ["Bought", "Sold", "Clauses paid", "Clauses charged"]) {
      expect(html).toContain(label);
    }
  });

  it("shows the total, the count and the average of a side", () => {
    const html = render([
      op({ id: "b1", amount: 3_000_000 }),
      op({ id: "b2", amount: 1_000_000 }),
    ]);
    expect(html).toContain("4.0M");
    expect(html).toContain("2.0M");
  });

  it("names the player of the biggest deal on a side", () => {
    const html = render([op({ id: "b", playerId: "p2", amount: 9_000_000 })]);
    expect(html).toContain("biggest 9.0M");
    expect(html).toContain("Otxoa");
  });

  it("says what is missing rather than leaving a bare caption", () => {
    // The dash in the numbers is only safe because the count beside it reads nought;
    // the caption still says which nothing this is.
    const html = render([]);
    expect(html).toContain("Nothing bought yet");
    expect(html).toContain("No player taken off them");
  });

  it("sums the four sides into cash in, cash out and the difference", () => {
    const html = render([
      op({ id: "b", activityType: 31, amount: 10_000_000 }),
      op({ id: "s", activityType: 33, amount: 4_000_000 }),
      op({ id: "cp", activityType: 1, actorManagerId: ME, counterpartyManagerId: THEM, amount: 5_000_000 }),
      op({ id: "cc", activityType: 1, actorManagerId: THEM, counterpartyManagerId: ME, amount: 3_000_000 }),
    ]);
    expect(html).toContain("Cash in");
    expect(html).toContain("7.0M");
    expect(html).toContain("Cash out");
    expect(html).toContain("15.0M");
    expect(html).toContain("−8.0M");
  });

  it("signs a positive difference and colours it as money taken", () => {
    const html = render([op({ id: "s", activityType: 33, amount: 4_000_000 })]);
    expect(html).toContain("+4.0M");
    expect(html).toContain("var(--board-gain)");
  });

  it("leaves an exactly level difference unsigned and uncoloured", () => {
    // Neither made nor lost. Tinting it would make a reader look for a reason.
    const html = render([
      op({ id: "b", activityType: 31, amount: 4_000_000 }),
      op({ id: "s", activityType: 33, amount: 4_000_000 }),
    ]);
    expect(html).toContain("Difference");
    expect(html).not.toContain("+0K");
    expect(html).not.toContain("−0K");
  });

  it("keeps a clause-raided manager's sales empty while their cash in is not", () => {
    // The whole point of the split, seen from the page: money arrived, nothing was sold.
    const html = render([
      op({ id: "cc", activityType: 1, actorManagerId: THEM, counterpartyManagerId: ME, amount: 3_000_000 }),
    ]);
    expect(html).toContain("Nothing sold yet");
    expect(html).toContain("3.0M");
  });
});

describe("MarketMoney operation counts", () => {
  it("counts each of the four sides separately", () => {
    const html = render([
      op({ id: "b1", activityType: 31, amount: 1_000_000 }),
      op({ id: "b2", activityType: 31, amount: 2_000_000 }),
      op({ id: "b3", activityType: 31, amount: 3_000_000 }),
      op({ id: "s", activityType: 33, amount: 4_000_000 }),
      op({ id: "cp", activityType: 1, actorManagerId: ME, counterpartyManagerId: THEM, amount: 5_000_000 }),
      op({ id: "cc1", activityType: 1, actorManagerId: THEM, counterpartyManagerId: ME, amount: 6_000_000 }),
      op({ id: "cc2", activityType: 1, actorManagerId: THEM, counterpartyManagerId: ME, amount: 7_000_000 }),
    ]);
    // Bought 3, Sold 1, Clauses paid 1, Clauses charged 2 — read off the Ops column.
    const cells = [...html.matchAll(/text-\[11px\] tabular-nums"[^>]*>(\d+)</g)].map((m) => m[1]);
    expect(cells).toEqual(["3", "1", "1", "2"]);
    expect(html).toContain("Ops");
  });

  it("counts the operations behind cash in and cash out", () => {
    const html = render([
      op({ id: "b", activityType: 31, amount: 1_000_000 }),
      op({ id: "s", activityType: 33, amount: 4_000_000 }),
      op({ id: "cc", activityType: 1, actorManagerId: THEM, counterpartyManagerId: ME, amount: 6_000_000 }),
    ]);
    expect(html).toContain("2 operations");
    expect(html).toContain("1 operation<");
  });

  it("does not count the difference, which is not made of operations", () => {
    const html = render([op({ id: "b", activityType: 31, amount: 1_000_000 })]);
    const notes = [...html.matchAll(/(\d+) operations?</g)].map((m) => m[0]);
    expect(notes).toHaveLength(2);
  });
});
