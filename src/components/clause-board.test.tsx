import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClauseRow } from "@/lib/domain/market";
import type { CatalogueRow } from "@/lib/domain/players";
import { ClauseBoard } from "./clause-board";

const NOW = new Date("2026-09-09T12:00:00Z");

const player = (id: string, over: Partial<CatalogueRow> = {}): CatalogueRow => ({
  id, nickname: id, position: "Forward", status: "ok",
  currentValue: 1_000_000, seasonPoints: 0, averagePoints: null, gameweeksRecorded: 0,
  ownerTeamId: "t1", ownerName: "Ada", clubName: null, ...over,
});

const render = (board: ClauseRow[], rows: CatalogueRow[]) =>
  renderToStaticMarkup(
    <ClauseBoard
      board={board}
      players={new Map(rows.map((r) => [r.id, r]))}
      owners={new Map([[1, { teamId: "t1", name: "Ada" }]])}
      now={NOW}
      logBegan={new Date("2026-08-11T00:00:00Z")}
    />,
  );

const free = (id: string): ClauseRow => ({ playerId: id, managerId: 1, protectedUntil: null });
const locked = (id: string, until: string): ClauseRow => ({
  playerId: id, managerId: 1, protectedUntil: new Date(until),
});

describe("ClauseBoard", () => {
  it("counts both groups, which is the headline a raider reads first", () => {
    const html = render([free("a"), free("b"), locked("c", "2026-09-20T10:00:00Z")], [player("a"), player("b"), player("c")]);
    expect(html).toContain("Takeable now · 2");
    expect(html).toContain("1 locked");
  });

  it("ranks the takeable by value, since they are all available anyway", () => {
    const html = render(
      [free("cheap"), free("dear")],
      [player("cheap", { currentValue: 1_000_000 }), player("dear", { currentValue: 9_000_000 })],
    );
    expect(html.indexOf("dear")).toBeLessThan(html.indexOf("cheap"));
  });

  it("counts down in hours below a day, because that changes what you do tonight", () => {
    // "in 1 day" for something happening in ninety minutes is the difference between
    // acting this evening and missing it.
    const html = render([locked("soon", "2026-09-09T14:00:00Z")], [player("soon")]);
    expect(html).toContain("2 hours");
    expect(html).not.toContain("1 day");
  });

  it("says under an hour rather than rounding to zero", () => {
    const html = render([locked("imminent", "2026-09-09T12:30:00Z")], [player("imminent")]);
    expect(html).toContain("under an hour");
  });

  it("pluralises a single day and a single hour", () => {
    expect(render([locked("a", "2026-09-10T13:00:00Z")], [player("a")])).toContain("1 day");
    expect(render([locked("b", "2026-09-09T13:00:00Z")], [player("b")])).toContain("1 hour");
  });

  it("names when the first lock lifts, not only how long", () => {
    const html = render([locked("a", "2026-09-20T10:00:00Z")], [player("a")]);
    expect(html).toContain("first lifts");
  });

  it("links the player and the owner, because a raid needs both", () => {
    const html = render([free("a")], [player("a")]);
    expect(html).toContain('href="/players/a"');
    expect(html).toContain('href="/teams/t1"');
  });

  it("prints market value and never a clause price", () => {
    // The clause is a function of market value this portal does not know; printing one
    // would be inventing a figure on the screen most likely to be acted on.
    const html = render([free("a")], [player("a", { currentValue: 4_000_000 })]);
    expect(html).toContain("4.0M");
  });

  it("draws an unknown value as a dash", () => {
    expect(render([free("a")], [player("a", { currentValue: null })])).toContain("—");
  });

  it("counts the rest rather than listing a wall of them", () => {
    const many = Array.from({ length: 14 }, (_, i) => `p${i}`);
    const html = render(many.map(free), many.map((id) => player(id)));
    expect(html).toContain("and 4 more");
  });

  it("says out loud what could make it wrong", () => {
    // A gap in the sweep would hide an acquisition and show a locked player as free.
    expect(render([free("a")], [player("a")])).toContain("gap in the sweep");
  });

  it("tells an unread squad apart from a league with nobody held", () => {
    expect(render([], [])).toContain("No squad has been read yet");
  });

  it("says so when everybody is locked", () => {
    const html = render([locked("a", "2026-09-20T10:00:00Z")], [player("a")]);
    expect(html).toContain("Every held player is inside their fifteen days");
  });
});
