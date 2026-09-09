import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { MarketOperation } from "@/lib/domain/market";
import { MarketFeed, type MarketFocus } from "./market-feed";

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

const feed = (operations: MarketOperation[], focus: MarketFocus = null) =>
  renderToStaticMarkup(
    <MarketFeed
      operations={operations}
      managerNames={new Map([[1, "Ada"], [2, "Bruno"]])}
      playerNames={new Map([["p1", "F. Garcés"], ["p2", "Otxoa"]])}
      teamIdByManagerId={new Map([[1, "t1"], [2, "t2"]])}
      focus={focus}
    />,
  );

describe("MarketFeed", () => {
  it("says who bought whom, and for how much", () => {
    const html = feed([op()]);
    expect(html).toContain("Ada");
    expect(html).toContain("bought");
    expect(html).toContain("F. Garcés");
    expect(html).toContain("2.0M");
  });

  it("marks a sale inside five days", () => {
    const html = feed([
      op({ id: "sell", activityType: 33, occurredAt: new Date("2026-09-07T14:59:00Z") }),
      op({ id: "buy", activityType: 31, occurredAt: new Date("2026-09-03T15:02:00Z") }),
    ]);
    expect(html).toContain("inside five days");
  });

  it("says a holding period is unknown rather than implying it was kept", () => {
    // Ruling 5. A sale with no purchase in the log is most of week one, and the one
    // thing the page must never do is let it read as a clean record.
    const html = feed([op({ id: "sell", activityType: 33 })]);
    expect(html).toContain("before this log began");
    expect(html).not.toContain("inside five days");
  });

  it("does not draw an operation it cannot name", () => {
    // Ruling 8: types 4, 6 and 7 are stored and not rendered. "Unknown operation" is
    // noise, and a weekly payout is not a market movement.
    const html = feed([op({ id: "mystery", activityType: 4 }), op({ id: "weekly", activityType: 6, playerId: null })]);
    expect(html).not.toContain("mystery");
    expect(html).toContain("No market movements yet");
  });

  it("falls back to the raw id for a manager or player it cannot name", () => {
    // Ruling 7's read side: no foreign key means a row can name somebody unknown, and
    // the feed shows the id rather than dropping the movement or rendering "undefined".
    const html = feed([op({ actorManagerId: 99, playerId: "p9" })]);
    expect(html).toContain("99");
    expect(html).toContain("p9");
  });
});

describe("MarketFeed, focused", () => {
  it("draws only the focused player's rows", () => {
    const html = feed(
      [op({ id: "a", playerId: "p1" }), op({ id: "b", playerId: "p2" })],
      { playerId: "p1" },
    );
    expect(html).toContain("F. Garcés");
    expect(html).not.toContain("Otxoa");
  });

  it("draws a manager's own moves", () => {
    const html = feed(
      [op({ id: "a", actorManagerId: 1 }), op({ id: "b", actorManagerId: 2, playerId: "p2" })],
      { managerId: 1 },
    );
    expect(html).toContain("Ada");
    expect(html).not.toContain("Otxoa");
  });

  it("counts a manager as involved when a player was taken FROM them", () => {
    // A clause raid read from the losing side is part of that manager's story, and
    // arguably the part they would most want to point at. Actor-only would hide it.
    const html = feed(
      [op({ id: "t", activityType: 1, actorManagerId: 2, counterpartyManagerId: 1 })],
      { managerId: 1 },
    );
    expect(html).toContain("F. Garcés");
  });

  it("still dates a holding from a purchase outside the focus", () => {
    // The trap this whole shape exists to avoid. The sale and its purchase are both in
    // the list handed over; the focus hides neither from the arithmetic, only from the
    // drawing. Filtering before the component would leave this row claiming the period
    // was unknowable — reporting a broken rule as a shrug.
    const html = feed(
      [
        op({ id: "sell", activityType: 33, playerId: "p1", occurredAt: new Date("2026-09-07T14:59:00Z") }),
        op({ id: "buy", activityType: 31, playerId: "p1", occurredAt: new Date("2026-09-03T15:02:00Z") }),
        op({ id: "noise", activityType: 31, playerId: "p2", occurredAt: new Date("2026-09-01T10:00:00Z") }),
      ],
      { playerId: "p1" },
    );
    expect(html).toContain("inside five days");
    expect(html).not.toContain("before this log began");
  });

  it("says something different when a focused feed is empty", () => {
    const html = feed([op({ playerId: "p2" })], { playerId: "p1" });
    expect(html).toContain("reaches back only as far as the first sweep");
    expect(html).not.toContain("next sweep captures");
  });
});

describe("MarketFeed links", () => {
  it("links the manager to their page and the player to theirs", () => {
    const html = feed([op()]);
    expect(html).toContain('href="/teams/t1"');
    expect(html).toContain('href="/players/p1"');
  });

  it("names the counterparty of a transfer as a link too", () => {
    const html = feed([op({ activityType: 1, actorManagerId: 1, counterpartyManagerId: 2 })]);
    expect(html).toContain('href="/teams/t2"');
  });

  it("does not link the player whose own page this is", () => {
    // A link to the page you are already on is a dead control that costs a tap to find
    // out. The manager beside it is still a link.
    const html = feed([op()], { playerId: "p1" });
    expect(html).not.toContain('href="/players/p1"');
    expect(html).toContain("F. Garcés");
    expect(html).toContain('href="/teams/t1"');
  });

  it("does not link the manager whose own page this is", () => {
    const html = feed([op()], { managerId: 1 });
    expect(html).not.toContain('href="/teams/t1"');
    expect(html).toContain("Ada");
    expect(html).toContain('href="/players/p1"');
  });

  it("still names a manager the teams table does not know, without a link", () => {
    // `market_operations` is deliberately the target of no foreign key: an operation can
    // name a manager who joined between standings syncs. It renders, unlinked.
    const html = feed([op({ actorManagerId: 99 })]);
    expect(html).toContain("99");
    expect(html).not.toContain('href="/teams/99"');
  });
});

describe("MarketFeed, what a sale made", () => {
  const buy = (amount: number) =>
    op({ id: "buy", activityType: 31, amount, occurredAt: new Date("2026-09-01T10:00:00Z") });
  const sell = (amount: number) =>
    op({ id: "sell", activityType: 33, amount, occurredAt: new Date("2026-09-08T10:00:00Z") });

  it("shows a gain in green, with an up arrow", () => {
    const html = feed([sell(5_000_000), buy(2_000_000)]);
    expect(html).toContain("▲ 3.0M");
    expect(html).toContain("var(--board-gain)");
  });

  it("shows a loss in red, with a down arrow and no minus sign", () => {
    // The arrow carries the direction; a "−" beside it would say it twice.
    const html = feed([sell(4_000_000), buy(9_000_000)]);
    expect(html).toContain("▼ 5.0M");
    expect(html).toContain("var(--board-alert)");
    expect(html).not.toContain("▼ −");
  });

  it("says nothing at all when the purchase predates the log", () => {
    // Not "0" — an unknowable profit rendered as break-even would be a claim we cannot
    // make, on the row where the reader is most likely to believe it.
    const html = feed([sell(5_000_000)]);
    expect(html).toContain("before this log began");
    expect(html).not.toContain("▲");
    expect(html).not.toContain("▼");
  });

  it("draws a break-even sale as a figure, with no arrow and no colour", () => {
    const html = feed([sell(3_000_000), buy(3_000_000)]);
    expect(html).toContain("3.0M");
    expect(html).not.toContain("▲");
    expect(html).not.toContain("▼");
  });

  it("keeps the five-day mark beside the money, not instead of it", () => {
    const html = feed([
      op({ id: "buy", activityType: 31, amount: 1_000_000, occurredAt: new Date("2026-09-03T15:02:00Z") }),
      op({ id: "sell", activityType: 33, amount: 4_000_000, occurredAt: new Date("2026-09-07T14:59:00Z") }),
    ]);
    expect(html).toContain("inside five days");
    expect(html).toContain("▲ 3.0M");
  });

  it("puts no money line on a purchase, which has made nothing yet", () => {
    const html = feed([buy(2_000_000)]);
    expect(html).not.toContain("▲");
    expect(html).not.toContain("held");
  });
});

describe("MarketFeed, what a clause cost the manager who lost the player", () => {
  const boughtBy2 = op({
    id: "buy2",
    activityType: 31,
    actorManagerId: 2,
    amount: 3_000_000,
    occurredAt: new Date("2026-08-01T10:00:00Z"),
  });
  const raid = op({
    id: "raid",
    activityType: 1,
    actorManagerId: 1,
    counterpartyManagerId: 2,
    amount: 8_000_000,
    occurredAt: new Date("2026-09-01T10:00:00Z"),
  });

  it("shows what the raided manager made, named so it is not read as the raider's", () => {
    // The row says "Ada received F. Garcés from Bruno"; the figure below is Bruno's.
    const html = feed([raid, boughtBy2]);
    expect(html).toContain("Bruno");
    expect(html).toContain("▲ 5.0M");
  });

  it("passes no five-day verdict on a clause, because they did not choose to sell", () => {
    const html = feed([raid, boughtBy2]);
    expect(html).not.toContain("inside five days");
    expect(html).not.toContain("held");
  });

  it("says nothing when the raided manager's purchase predates the log", () => {
    const html = feed([raid]);
    expect(html).not.toContain("▲");
    expect(html).not.toContain("▼");
  });

  it("still starts the raider's own clock, so their later sale is priced", () => {
    const html = feed([
      boughtBy2,
      raid,
      op({
        id: "resold",
        activityType: 33,
        actorManagerId: 1,
        amount: 11_000_000,
        occurredAt: new Date("2026-09-20T10:00:00Z"),
      }),
    ]);
    // The raider paid 8M and sold for 11M.
    expect(html).toContain("▲ 3.0M");
    // And the victim's own 5M is still on the clause row.
    expect(html).toContain("▲ 5.0M");
  });
});
