import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CatalogueRow } from "@/lib/domain/players";
import { rankFormations } from "@/lib/domain/lineup";
import { LineupBoard } from "./lineup-board";

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
  buyoutClause: null,
  clauseLockedUntil: null,
  shielded: false,
  ...over,
});

const full = [
  row("gk", { position: "Goalkeeper" }),
  ...[1, 2, 3, 4, 5].map((n) => row(`d${n}`, { position: "Defender" })),
  ...[1, 2, 3, 4, 5].map((n) => row(`m${n}`, { position: "Midfielder" })),
  ...[1, 2, 3].map((n) => row(`f${n}`, { position: "Forward" })),
];

const render = (
  rows: CatalogueRow[],
  ownershipKnown = true,
  metric: "points" | "average" = "points",
  portraits: Map<string, string> = new Map(),
) => {
  const ranked = rankFormations(rows, metric);
  const showing = ranked.find((r) => r.shortfall === null) ?? null;
  return renderToStaticMarkup(
    <LineupBoard
      ranked={ranked}
      showing={showing}
      metric={metric}
      teamId="t1"
      ownershipKnown={ownershipKnown}
      portraits={portraits}
    />,
  );
};

describe("LineupBoard", () => {
  it("names the formation it is showing and lists its eleven, each player linked", () => {
    const html = render(full);
    expect(html).toContain("3-4-3");
    expect(html).toContain('href="/players/gk"');
    expect(html).toContain('href="/players/f1"');
  });

  it("groups the eleven by line on the pitch, keeper first", () => {
    // The eleven is a pitch now, not a list: there is no visible line label any more,
    // only the `data-line` hook the pitch draws one row per line from. The claim this
    // test makes is the same one the old grouped list made — four groups, keeper first —
    // aimed at the markup that now actually carries it.
    const html = render(full);
    expect(html.match(/data-line="/g)).toHaveLength(4);
    expect(html.indexOf('data-line="Goalkeeper"')).toBeLessThan(
      html.indexOf('data-line="Forward"'),
    );
  });

  it("lists every formation, with a link that selects it", () => {
    const html = render(full);
    expect(html).toContain("formation=4-4-2");
    expect(html).toContain("formation=5-3-2");
  });

  it("marks a doubtful player, because doubt is the reader's call", () => {
    // The score has to beat the other forwards or the tie-break would sort "iffy" last
    // and they would never reach the eleven — the test would then pass for no reason.
    const html = render([
      ...full,
      row("iffy", { position: "Forward", status: "doubtful", seasonPoints: 999 }),
    ]);
    // The `!` mark carries the status itself as its own accessible name — `statusLabel`'s
    // own wording, on the row — and the caption below the pitch explains the shape once,
    // aggregated, for whichever marks actually appear.
    expect(html).toMatch(/role="img"\s+aria-label="Doubtful"/);
    expect(html).toContain("! injured, doubtful or suspended (1)");
  });

  it("marks a player whose average rests on fewer than three gameweeks", () => {
    const rows = full.map((r) =>
      r.id === "f1" ? { ...r, gameweeksRecorded: 1 } : r,
    );
    const html = render(rows);
    expect(html).toMatch(/role="img"\s+aria-label="Average from 1 gameweek"/);
    expect(html).toContain("~ an average from fewer than 3 gameweeks (1)");
  });

  it("says nothing extra below the pitch when nobody in the eleven carries a mark", () => {
    // `full` is entirely `ok`-status players with four gameweeks recorded each — no
    // flagged status, no thin sample. No mark, no caption: there is nothing to explain.
    const html = render(full);
    expect(html).not.toContain('role="img"');
    expect(html).not.toContain("injured, doubtful or suspended");
    expect(html).not.toContain("an average from fewer than");
  });

  it("says which line is short when nothing can be fielded, and names the nearest", () => {
    // "No formation possible" on a normal squad reads as a broken portal.
    const thin = [
      row("gk", { position: "Goalkeeper" }),
      ...[1, 2, 3, 4, 5].map((n) => row(`d${n}`, { position: "Defender" })),
      row("m1", { position: "Midfielder" }),
      ...[1, 2, 3, 4].map((n) => row(`f${n}`, { position: "Forward" })),
    ];
    const html = render(thin);
    expect(html).toContain("No formation");
    expect(html).toContain("5-3-2");
    expect(html).toContain("2 more midfielders");
  });

  it("says one midfielder, not 1 midfielders", () => {
    // 1 GK, 3 DF, 3 MF, 1 FW. Every formation is three players away, so the nearest is
    // the first in FORMATIONS order — 5-4-1, needing two defenders and one midfielder,
    // which exercises both the plural and the singular in one string.
    const thin = [
      row("gk", { position: "Goalkeeper" }),
      ...[1, 2, 3].map((n) => row(`d${n}`, { position: "Defender" })),
      ...[1, 2, 3].map((n) => row(`m${n}`, { position: "Midfielder" })),
      row("f1", { position: "Forward" }),
    ];
    const html = render(thin);
    expect(html).toContain("2 more defenders");
    expect(html).toContain("1 more midfielder");
    expect(html).not.toContain("1 more midfielders");
  });

  it("tells an empty squad apart from a portal that has read no squads at all", () => {
    expect(render([], false)).toContain("No squad has been read yet");
    expect(render([], true)).toContain("No formation");
  });

  it("renders a dash, not a number, for an unknown average and the total it forces unknown", () => {
    // 1 GK, 3 DF, 4 MF, 3 FW makes 3-4-3 the only fieldable formation, forcing "never" —
    // whose average is unknown — into the eleven. That formation's total is therefore
    // unknown too, and neither should print as if it had been measured.
    const forced = [
      row("gk", { position: "Goalkeeper", averagePoints: 1 }),
      ...[1, 2, 3].map((n) => row(`d${n}`, { position: "Defender", averagePoints: 1 })),
      ...[1, 2, 3, 4].map((n) => row(`m${n}`, { position: "Midfielder", averagePoints: 1 })),
      row("scorer", { position: "Forward", averagePoints: 5 }),
      row("other", { position: "Forward", averagePoints: 5 }),
      row("never", { position: "Forward", averagePoints: null, gameweeksRecorded: 0 }),
    ];
    const html = render(forced, true, "average");
    expect(html).toContain('href="/players/never"');
    const dashes = html.match(/—/g) ?? [];
    // At least one dash for "never"'s own figure, and one for the unknown total shown
    // beside the formation's name.
    expect(dashes.length).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain("NaN");
  });

  it("wears the squad's faces when the page has them", () => {
    // The portraits arrive by id from `loadPortraits` rather than riding on the catalogue
    // rows, so this board draws a face for whoever the map knows and initials for the
    // rest — the same pitch the round lineups use, fed from a different place.
    const html = render(full, true, "points", new Map([["gk", "https://assets-fantasy.llt-services.com/players/gk.png"]]));
    expect(html).toContain("<img");
  });

  it("draws initials when the page has no face for a player", () => {
    expect(render(full)).not.toContain("<img");
  });
});
