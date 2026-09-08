import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { MarketOperation } from "@/lib/domain/market";
import { MarketFeed } from "./market-feed";

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

const feed = (operations: MarketOperation[]) =>
  renderToStaticMarkup(
    <MarketFeed
      operations={operations}
      managerNames={new Map([[1, "Ada"], [2, "Bruno"]])}
      playerNames={new Map([["p1", "F. Garcés"]])}
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
