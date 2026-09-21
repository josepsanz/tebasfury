import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { prizePot } from "@/lib/domain/constitution";
import { PrizeLadder } from "./prize-ladder";

const ladder = (teamCount: number) =>
  renderToStaticMarkup(<PrizeLadder teamCount={teamCount} pot={prizePot(teamCount)} />);

describe("PrizeLadder", () => {
  it("leads with what the pot holds, and where it came from", () => {
    const html = ladder(13);
    expect(html).toContain("195.00 €");
    expect(html).toContain("13 managers");
  });

  it("names each place and what it takes, in euros as well as per cent", () => {
    const html = ladder(13);
    expect(html).toContain("Champion");
    expect(html).toContain("126.75 €");
    expect(html).toContain("65 %");
    expect(html).toContain("Runner-up");
    expect(html).toContain("48.75 €");
    expect(html).toContain("Third");
    expect(html).toContain("19.50 €");
  });

  it("orders the places as the money falls, best first", () => {
    const html = ladder(13);
    expect(html.indexOf("126.75 €")).toBeLessThan(html.indexOf("48.75 €"));
    expect(html.indexOf("48.75 €")).toBeLessThan(html.indexOf("19.50 €"));
  });

  it("says the shares alone before the league has any managers", () => {
    // The teams table is empty before the first sync. "0.00 €" three times is arithmetic
    // nobody asked for; the split is still the law and can still be read.
    const html = ladder(0);
    expect(html).not.toContain("0.00 €");
    expect(html).toContain("65 %");
    expect(html).toContain("no managers yet");
  });

  it("counts one manager as one, not as 1 managers", () => {
    expect(ladder(1)).toContain("1 manager ×");
  });
});
