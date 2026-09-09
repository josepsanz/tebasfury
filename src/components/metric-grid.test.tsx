import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MetricGrid } from "./metric-grid";

describe("MetricGrid", () => {
  it("shows a figure under its label, with its caption", () => {
    const html = renderToStaticMarkup(
      <MetricGrid items={[{ label: "Best round", value: "71", note: "Villaone, GW1" }]} />,
    );
    expect(html).toContain("Best round");
    expect(html).toContain("71");
    expect(html).toContain("Villaone, GW1");
  });

  it("colours a rising figure and a falling one differently, and leaves the rest alone", () => {
    const up = renderToStaticMarkup(
      <MetricGrid items={[{ label: "Trend", value: "▲ 6 pts/round", tone: "up" }]} />,
    );
    const down = renderToStaticMarkup(
      <MetricGrid items={[{ label: "Trend", value: "▼ 6 pts/round", tone: "down" }]} />,
    );
    const plain = renderToStaticMarkup(<MetricGrid items={[{ label: "Average", value: "42" }]} />);

    expect(up).toContain("var(--board-gain)");
    expect(down).toContain("var(--board-alert)");
    expect(plain).not.toContain("var(--board-gain)");
    expect(plain).not.toContain("var(--board-alert)");
  });

  it("renders an unavailable figure as its reason, which is a value like any other", () => {
    // Ruling 7: never a bare dash. The reason arrives as the value string.
    const html = renderToStaticMarkup(
      <MetricGrid items={[{ label: "Trend", value: "Needs another round" }]} />,
    );
    expect(html).toContain("Needs another round");
  });

  it("renders nothing when it has nothing to show", () => {
    expect(renderToStaticMarkup(<MetricGrid items={[]} />)).toBe("");
  });
});
