import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { MarketOperation } from "@/lib/domain/market";
import { FairPlayRegister } from "./fair-play-register";

const op = (over: Partial<MarketOperation> = {}): MarketOperation => ({
  id: "op1",
  activityType: 31,
  actorManagerId: 1,
  counterpartyManagerId: null,
  playerId: "p1",
  amount: 2_000_000,
  occurredAt: new Date("2026-09-03T15:02:00Z"),
  ...over,
});

const register = (operations: MarketOperation[]) =>
  renderToStaticMarkup(
    <FairPlayRegister
      operations={operations}
      managerNames={new Map([[1, "Ada"], [2, "Bruno"]])}
      playerNames={
        new Map([["p1", "F. Garcés"], ["p2", "Otxoa"], ["p3", "Iñigo"], ["p4", "Zubimendi"]])
      }
      teamIdByManagerId={new Map([[1, "t1"], [2, "t2"]])}
    />,
  );

/** A purchase and the sale that closes it, `hours` apart. */
const heldFor = (hours: number, over: { player: string; manager: number; paid: number; got: number }) => [
  op({
    id: `buy-${over.player}`,
    activityType: 31,
    actorManagerId: over.manager,
    playerId: over.player,
    amount: over.paid,
    occurredAt: new Date("2026-09-01T12:00:00Z"),
  }),
  op({
    id: `sell-${over.player}`,
    activityType: 33,
    actorManagerId: over.manager,
    playerId: over.player,
    amount: over.got,
    occurredAt: new Date(Date.parse("2026-09-01T12:00:00Z") + hours * 3_600_000),
  }),
];

describe("FairPlayRegister", () => {
  it("names who sold whom, how long they held them and how short that fell", () => {
    const html = register(heldFor(95.95, { player: "p1", manager: 1, paid: 2_000_000, got: 5_611_947 }));
    expect(html).toContain("Ada");
    expect(html).toContain("sold");
    expect(html).toContain("F. Garcés");
    expect(html).toContain("held 3.998 days");
    expect(html).toContain("1 day short");
  });

  it("writes a miss of minutes as minutes", () => {
    // The reason the register exists in this shape: three of the league's four breaches
    // missed the rule by minutes, and a page that rounded them to days would accuse
    // three managers of something they did not do.
    const html = register(heldFor(119.8, { player: "p1", manager: 1, paid: 2_000_000, got: 1_412_984 }));
    expect(html).toContain("held 4.992 days");
    expect(html).toContain("12 minutes short");
  });

  it("shows what the sale made or lost", () => {
    const html = register(heldFor(50.18, { player: "p1", manager: 2, paid: 3_000_000, got: 2_094_723 }));
    expect(html).toContain("905K");
  });

  it("leaves out a player taken by clause, however briefly they were held", () => {
    // Ruling 3: the five-day rule is about CHOOSING to sell. Listing the manager who was
    // raided points the register at the wrong person.
    const html = register([
      op({ id: "buy", activityType: 31, actorManagerId: 1, playerId: "p3", occurredAt: new Date("2026-09-05T10:00:00Z") }),
      op({
        id: "clause",
        activityType: 1,
        actorManagerId: 2,
        counterpartyManagerId: 1,
        playerId: "p3",
        occurredAt: new Date("2026-09-06T10:00:00Z"),
      }),
    ]);
    expect(html).not.toContain("Iñigo");
    expect(html).toContain("Nobody has broken the five-day rule");
  });

  it("leaves out a sale whose purchase happened before the log, and says how many those are", () => {
    // An unknowable period is not a breach and never a clean record either. Silence about
    // them would let "no breaches" read as "nobody ever broke it".
    const html = register([
      op({ id: "sell", activityType: 33, actorManagerId: 2, playerId: "p4", occurredAt: new Date("2026-09-06T10:00:00Z") }),
    ]);
    expect(html).not.toContain("Zubimendi");
    expect(html).toContain("1 sale");
    expect(html).toContain("before the log began");
  });

  it("puts the most recent breach first", () => {
    const html = register([
      ...heldFor(95.95, { player: "p1", manager: 1, paid: 2_000_000, got: 5_611_947 }),
      op({ id: "buy-p2", activityType: 31, actorManagerId: 2, playerId: "p2", amount: 3_000_000, occurredAt: new Date("2026-09-10T12:00:00Z") }),
      op({ id: "sell-p2", activityType: 33, actorManagerId: 2, playerId: "p2", amount: 2_000_000, occurredAt: new Date("2026-09-12T12:00:00Z") }),
    ]);
    expect(html.indexOf("Otxoa")).toBeLessThan(html.indexOf("F. Garcés"));
  });

  it("links both names to their pages", () => {
    const html = register(heldFor(95.95, { player: "p1", manager: 1, paid: 2_000_000, got: 5_611_947 }));
    expect(html).toContain('href="/teams/t1"');
    expect(html).toContain('href="/players/p1"');
  });

  it("says the rule is unbroken when it is, rather than drawing an empty list", () => {
    const html = register(heldFor(240, { player: "p1", manager: 1, paid: 2_000_000, got: 3_000_000 }));
    expect(html).toContain("Nobody has broken the five-day rule");
    expect(html).not.toContain("short");
  });
});
