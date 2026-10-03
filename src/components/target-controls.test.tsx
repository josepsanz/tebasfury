import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TargetControls } from "./target-controls";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

describe("TargetControls", () => {
  it("offers both lenses, every route, the positions and the injury switch, with the view selected", () => {
    const html = renderToStaticMarkup(
      <TargetControls
        view={{ lens: "performance", route: "clause", position: null, showInjured: false }}
        positions={["Goalkeeper", "Forward"]}
      />,
    );
    for (const label of ["Investment", "Performance", "Auction", "Listed", "Clause", "Goalkeeper", "Forward", "Hidden", "Shown"]) {
      expect(html).toContain(label);
    }
    expect(html).toMatch(/<option[^>]*selected[^>]*>Performance</);
    expect(html).toMatch(/<option[^>]*selected[^>]*>Clause</);
  });
});
