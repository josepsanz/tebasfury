import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { pointsSeries, valueSeries } from "@/lib/domain/players";
import { PlayerCharts } from "./player-charts";

describe("PlayerCharts", () => {
  const points = pointsSeries([
    { gameweek: 1, points: 12 },
    { gameweek: 2, points: 28 },
  ]);
  const values = valueSeries([
    { takenOn: "2026-09-06", value: 11_000_000 },
    { takenOn: "2026-09-07", value: 12_400_000 },
  ]);

  it("titles both charts and puts the real numbers in a table", () => {
    const html = renderToStaticMarkup(<PlayerCharts points={points} values={values} />);
    expect(html).toContain("Points per gameweek");
    expect(html).toContain("Market value");
    expect(html).toContain("Show the numbers");
    expect(html).toContain("28");
    expect(html).toContain("12.4M");
  });

  it("says why the value chart starts where it does", () => {
    // The same honesty the team-value chart uses: this series only exists from the
    // first sweep onward, and the API publishes no history to fill in behind it.
    const html = renderToStaticMarkup(<PlayerCharts points={points} values={values} />);
    expect(html).toContain("only recorded from the first sweep onward");
  });

  it("renders a gameweek with no row as a gap, not as nought points", () => {
    const gappy = pointsSeries([
      { gameweek: 1, points: 12 },
      { gameweek: 3, points: 5 },
    ]);
    const html = renderToStaticMarkup(<PlayerCharts points={gappy} values={values} />);
    expect(html).toContain("—");
  });

  it("has an empty state for each chart before anything is swept", () => {
    const html = renderToStaticMarkup(<PlayerCharts points={[]} values={[]} />);
    expect(html.match(/Nothing has been swept yet\./g)).toHaveLength(2);
  });
});
