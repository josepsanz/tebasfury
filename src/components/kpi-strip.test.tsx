import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { KpiStrip } from "./kpi-strip";

describe("KpiStrip", () => {
  it("shows each figure under its own label", () => {
    const html = renderToStaticMarkup(
      <KpiStrip
        items={[
          { label: "Your rank", value: "3" },
          { label: "Total points", value: "228" },
        ]}
      />,
    );
    expect(html).toContain("Your rank");
    expect(html).toContain("3");
    expect(html).toContain("Total points");
    expect(html).toContain("228");
  });

  it("colours a rise and a fall differently, because they are the market's two words", () => {
    const up = renderToStaticMarkup(
      <KpiStrip items={[{ label: "Your rank", value: "3", delta: { text: "1", rising: true } }]} />,
    );
    const down = renderToStaticMarkup(
      <KpiStrip items={[{ label: "Your rank", value: "5", delta: { text: "2", rising: false } }]} />,
    );
    expect(up).toContain("var(--board-gain)");
    expect(up).not.toContain("var(--board-alert)");
    expect(down).toContain("var(--board-alert)");
    expect(down).not.toContain("var(--board-gain)");
  });

  it("says nothing at all when a figure has no movement to report", () => {
    const html = renderToStaticMarkup(<KpiStrip items={[{ label: "Total points", value: "228" }]} />);
    expect(html).not.toContain("var(--board-gain)");
    expect(html).not.toContain("var(--board-alert)");
    expect(html).not.toContain("▲");
    expect(html).not.toContain("▼");
  });

  it("renders nothing when there is nothing to report", () => {
    expect(renderToStaticMarkup(<KpiStrip items={[]} />)).toBe("");
  });
});
