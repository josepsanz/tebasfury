import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import NotFound from "./not-found";

describe("NotFound", () => {
  it("names the player as missing from the catalogue and links back to it", () => {
    // Regression guard for the board going white: without this file, Next's own
    // fallback UI renders instead, with a hard-coded light-mode style block this
    // portal's dark treatment never agreed to. Existing at all, on the board's own
    // Link component, is most of what this test proves.
    const html = renderToStaticMarkup(<NotFound />);
    expect(html).toContain("catalogue");
    expect(html).toContain('href="/players"');
  });
});
