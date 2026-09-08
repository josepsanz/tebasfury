import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildTable, type Snapshot, type TeamRef } from "@/lib/domain/standings";
import { StandingsTable } from "./standings-table";

const teams: TeamRef[] = [
  { id: "a", managerName: "Manager A" },
  { id: "b", managerName: "Manager B" },
];

const snap = (
  teamId: string,
  gameweek: number,
  points: number,
  roundPosition: number,
  extra: Partial<Snapshot> = {},
): Snapshot => ({
  teamId,
  gameweek,
  points,
  roundPosition,
  livePoints: null,
  isProvisional: false,
  teamValue: null,
  ...extra,
});

// gw1: A 50 (1st), B 10 (2nd). gw2: A 10 (2nd in round), B 40 (1st in round) — the
// table stays A-then-B on cumulative points even though B won the round.
const season: Snapshot[] = [
  snap("a", 1, 50, 1),
  snap("b", 1, 10, 2),
  snap("a", 2, 10, 2, { isProvisional: true, livePoints: 10 }),
  snap("b", 2, 40, 1, { isProvisional: true, livePoints: 40 }),
];

describe("StandingsTable", () => {
  it("lists managers in table order with their cumulative points", () => {
    const rows = buildTable(season, teams);
    const html = renderToStaticMarkup(
      <StandingsTable rows={rows} formByTeam={{}} isLive={false} />,
    );

    const positionOfA = html.indexOf("Manager A");
    const positionOfB = html.indexOf("Manager B");
    expect(positionOfA).toBeGreaterThan(-1);
    expect(positionOfB).toBeGreaterThan(positionOfA);
    expect(html).toContain("60"); // A's cumulative total
    expect(html).toContain("50"); // B's cumulative total
  });

  it("spells movement out in words", () => {
    // Only one gameweek played: no previous position, so no movement text.
    const oneWeek = buildTable([snap("a", 1, 50, 1), snap("b", 1, 10, 2)], teams);
    const htmlNoMovement = renderToStaticMarkup(
      <StandingsTable rows={oneWeek} formByTeam={{}} isLive={false} />,
    );
    expect(htmlNoMovement).not.toContain("up from");
    expect(htmlNoMovement).not.toContain("down from");
    expect(htmlNoMovement).not.toContain("no change");

    // The table stays A-then-B across gw1 and gw2 (B wins the round but not the
    // table), so both managers should read "no change".
    const unchanged = buildTable(season, teams);
    const htmlUnchanged = renderToStaticMarkup(
      <StandingsTable rows={unchanged} formByTeam={{}} isLive={false} />,
    );
    expect(htmlUnchanged).toContain("no change");
    expect(htmlUnchanged).not.toContain("up from");
    expect(htmlUnchanged).not.toContain("down from");

    // A leads after gw1, then B overtakes on cumulative points in gw2 — an
    // actual table swap, so each manager should get the opposite word.
    const swapped = buildTable(
      [snap("a", 1, 50, 1), snap("b", 1, 10, 2), snap("a", 2, 5, 2), snap("b", 2, 50, 1)],
      teams,
    );
    const htmlSwapped = renderToStaticMarkup(
      <StandingsTable rows={swapped} formByTeam={{}} isLive={false} />,
    );
    expect(htmlSwapped).toContain("down from 1st");
    expect(htmlSwapped).toContain("up from 2nd");
  });

  it("shows green live points only when a round is live", () => {
    const rows = buildTable(season, teams);
    const live = renderToStaticMarkup(
      <StandingsTable rows={rows} formByTeam={{}} isLive={true} />,
    );
    expect(live).toContain("var(--board-gain)");
    expect(live).toContain("+10");
    expect(live).toContain("+40");
  });

  it("replaces the live column with form bars when nothing is live", () => {
    const rows = buildTable(season, teams);
    const formByTeam = { a: [10, 20, 30], b: [5, 5, 5] };
    const notLive = renderToStaticMarkup(
      <StandingsTable rows={rows} formByTeam={formByTeam} isLive={false} />,
    );
    expect(notLive).not.toContain("var(--board-gain)");
    expect(notLive).not.toContain("+10");
  });
});

describe("the viewer's own row", () => {
  const rows = buildTable(season, teams);

  it("marks it, and marks only it", () => {
    const html = renderToStaticMarkup(
      <StandingsTable rows={rows} formByTeam={{}} isLive={false} myTeamId="b" />,
    );
    expect(html.match(/aria-label="Your team"/g)).toHaveLength(1);
    // And it is B's row that carries it, not merely some row.
    expect(html.slice(html.indexOf("Manager B"))).toContain('aria-label="Your team"');
  });

  it("marks nothing when the viewer has claimed no team", () => {
    const html = renderToStaticMarkup(
      <StandingsTable rows={rows} formByTeam={{}} isLive={false} myTeamId={null} />,
    );
    expect(html).not.toContain('aria-label="Your team"');
  });
});
