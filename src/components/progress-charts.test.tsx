import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildSeries, type Snapshot, type TeamRef } from "@/lib/domain/standings";
import { applyPin, formatTooltipValue, ProgressCharts, type Pins } from "./progress-charts";

describe("applyPin", () => {
  const empty = (): Pins => ({ slots: [null, null, null, null, null, null], order: [] });
  const pinAll = (ids: string[]) => ids.reduce(applyPin, empty());

  it("keeps survivors' colours stable when one pinned manager is unpinned", () => {
    // Colour is assigned by slot index (PINNED_COLOURS[pinned.indexOf(teamId)]), so a
    // manager's slot must never move just because someone else unpinned.
    const pins = applyPin(pinAll(["a", "b", "c"]), "a");
    expect(pins.slots.indexOf("b")).toBe(1);
    expect(pins.slots.indexOf("c")).toBe(2);
  });

  it("refills the freed slot on the next pin, still without moving the others", () => {
    let pins = pinAll(["a", "b", "c"]);
    pins = applyPin(pins, "a"); // free slot 0
    pins = applyPin(pins, "d"); // takes slot 0
    expect(pins.slots).toEqual(["d", "b", "c", null, null, null]);
  });

  it("holds six at once, not three", () => {
    const pins = pinAll(["a", "b", "c", "d", "e", "f"]);
    expect(pins.slots).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("drops the longest-pinned manager when a seventh is pinned", () => {
    // Returning the slots unchanged — which is what this used to do at the cap — made a
    // click on a seventh badge do nothing, which reads as a broken control.
    const pins = applyPin(pinAll(["a", "b", "c", "d", "e", "f"]), "g");
    expect(pins.slots).toEqual(["g", "b", "c", "d", "e", "f"]);
    expect(pins.slots).not.toContain("a");
  });

  it("hands the evicted manager's colour to the newcomer and repaints nobody else", () => {
    const before = pinAll(["a", "b", "c", "d", "e", "f"]);
    const after = applyPin(before, "g");
    expect(after.slots.indexOf("g")).toBe(before.slots.indexOf("a"));
    for (const id of ["b", "c", "d", "e", "f"]) {
      expect(after.slots.indexOf(id)).toBe(before.slots.indexOf(id));
    }
  });

  it("evicts in pin order, not slot order, after an unpin has shuffled the slots", () => {
    // The slots alone cannot say who has been up longest: a slot index is a colour, not
    // a time. This is the case that would go wrong without the separate order list.
    let pins = pinAll(["a", "b", "c", "d", "e", "f"]);
    pins = applyPin(pins, "a"); // a leaves, freeing slot 0
    pins = applyPin(pins, "g"); // g takes slot 0, but is now the NEWEST pin
    pins = applyPin(pins, "h"); // full again — b is the oldest, not g
    expect(pins.slots).not.toContain("b");
    expect(pins.slots).toContain("g");
  });

  it("forgets an unpinned manager, so they are not evicted later while absent", () => {
    let pins = pinAll(["a", "b"]);
    pins = applyPin(pins, "a");
    expect(pins.order).toEqual(["b"]);
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
