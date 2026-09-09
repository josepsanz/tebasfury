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
  ...over,
});

const full = [
  row("gk", { position: "Goalkeeper" }),
  ...[1, 2, 3, 4, 5].map((n) => row(`d${n}`, { position: "Defender" })),
  ...[1, 2, 3, 4, 5].map((n) => row(`m${n}`, { position: "Midfielder" })),
  ...[1, 2, 3].map((n) => row(`f${n}`, { position: "Forward" })),
];

const render = (rows: CatalogueRow[], ownershipKnown = true, metric: "points" | "average" = "points") => {
  const ranked = rankFormations(rows, metric);
  const showing = ranked.find((r) => r.shortfall === null) ?? null;
  return renderToStaticMarkup(
    <LineupBoard
      ranked={ranked}
      showing={showing}
      metric={metric}
      teamId="t1"
      ownershipKnown={ownershipKnown}
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

  it("groups the eleven by line", () => {
    const html = render(full);
    for (const line of ["Goalkeeper", "Defender", "Midfielder", "Forward"]) {
      expect(html).toContain(line);
    }
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
    expect(html).toContain("Doubtful");
  });

  it("marks a player whose average rests on fewer than three gameweeks", () => {
    const rows = full.map((r) =>
      r.id === "f1" ? { ...r, gameweeksRecorded: 1 } : r,
    );
    expect(render(rows)).toContain("1 gameweek");
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
});
