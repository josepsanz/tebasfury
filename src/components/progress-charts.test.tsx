import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildSeries, type Snapshot, type TeamRef } from "@/lib/domain/standings";
import { applyPin, formatTooltipValue, ProgressCharts } from "./progress-charts";

describe("applyPin", () => {
  it("keeps survivors' colours stable when one pinned manager is unpinned", () => {
    // Colour is assigned by slot index (PINNED_COLOURS[pinned.indexOf(teamId)]),
    // so a manager's slot must never move just because someone else unpinned.
    let pinned: (string | null)[] = [null, null, null];
    pinned = applyPin(pinned, "a");
    pinned = applyPin(pinned, "b");
    pinned = applyPin(pinned, "c");
    pinned = applyPin(pinned, "a"); // unpin the first of the three

    expect(pinned.indexOf("b")).toBe(1);
    expect(pinned.indexOf("c")).toBe(2);
  });

  it("refills the freed slot on the next pin, still without moving the others", () => {
    let pinned: (string | null)[] = [null, null, null];
    pinned = applyPin(pinned, "a");
    pinned = applyPin(pinned, "b");
    pinned = applyPin(pinned, "c");
    pinned = applyPin(pinned, "a"); // free slot 0
    pinned = applyPin(pinned, "d"); // takes slot 0

    expect(pinned).toEqual(["d", "b", "c"]);
  });

  it("caps at three and leaves the slots untouched once full", () => {
    let pinned: (string | null)[] = [null, null, null];
    pinned = applyPin(pinned, "a");
    pinned = applyPin(pinned, "b");
    pinned = applyPin(pinned, "c");
    const full = pinned;
    pinned = applyPin(pinned, "d"); // no free slot

    expect(pinned).toEqual(full);
  });
});

describe("formatTooltipValue", () => {
  it("treats a null value as absent, not zero", () => {
    // A team value before its first sync is a genuine gap (that series only
    // accumulates forward), and must read as absent — not as a real "0.0M".
    expect(formatTooltipValue(null, (v) => `${v.toFixed(1)}M`)).toBe("—");
  });

  it("treats an undefined value as absent", () => {
    expect(formatTooltipValue(undefined, (v) => `${v}`)).toBe("—");
  });

  it("formats a real value", () => {
    expect(formatTooltipValue(180_000_000, (v) => `${(v / 1_000_000).toFixed(1)}M`)).toBe("180.0M");
  });
});

const teams: TeamRef[] = [
  { id: "a", managerName: "Alpha" },
  { id: "b", managerName: "Beta" },
];

const snap = (
  teamId: string,
  gameweek: number,
  points: number,
  extra: Partial<Snapshot> = {},
): Snapshot => ({
  teamId,
  gameweek,
  points,
  roundPosition: 1,
  livePoints: null,
  isProvisional: false,
  teamValue: null,
  ...extra,
});

describe("ProgressCharts", () => {
  it("renders all four chart titles and a details/table view with the real numbers", () => {
    const snapshots: Snapshot[] = [
      snap("a", 1, 50, { teamValue: 100_000_000 }),
      snap("b", 1, 40, { teamValue: 90_000_000 }),
      snap("a", 2, 30, { teamValue: 105_000_000 }),
      snap("b", 2, 60, { teamValue: 95_000_000 }),
    ];
    const series = buildSeries(snapshots, teams);
    const html = renderToStaticMarkup(<ProgressCharts series={series} teams={teams} />);

    for (const title of ["Points per gameweek", "Cumulative points", "Table position", "Team value"]) {
      expect(html).toContain(title);
    }
    expect(html).toContain("Show the numbers");
    // The pointsPerWeek table view: Alpha's row carries her real per-week points.
    expect(html).toMatch(/Alpha<\/td><td[^>]*>50<\/td><td[^>]*>30/);
    expect(html).toMatch(/Beta<\/td><td[^>]*>40<\/td><td[^>]*>60/);
  });

  it("shows a chart's own empty state before any gameweek has synced", () => {
    const series = buildSeries([], teams);
    const html = renderToStaticMarkup(<ProgressCharts series={series} teams={teams} />);
    expect(html).toContain("Team value only accumulates from the first sync onward");
    expect(html.match(/Nothing has synced yet\./g)).toHaveLength(3);
  });

  it("renders team value with real gaps as absent, not a false zero", () => {
    // Team value only accumulates forward — gw1 has none yet, gw2 does.
    const snapshots: Snapshot[] = [
      snap("a", 1, 50),
      snap("b", 1, 40),
      snap("a", 2, 30, { teamValue: 105_000_000 }),
      snap("b", 2, 60, { teamValue: 95_000_000 }),
    ];
    const series = buildSeries(snapshots, teams);
    const html = renderToStaticMarkup(<ProgressCharts series={series} teams={teams} />);
    // Team value's table view: gw1 is a real gap ("—"), gw2 has a real figure.
    expect(html).toMatch(/Alpha<\/td><td[^>]*>—<\/td><td[^>]*>105\.0M/);
    expect(html).toMatch(/Beta<\/td><td[^>]*>—<\/td><td[^>]*>95\.0M/);
  });
});
