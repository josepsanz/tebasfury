import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RoundPicker } from "./round-picker";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

describe("RoundPicker", () => {
  it("offers the season total first, then the rounds newest first", () => {
    // By May this list is 38 entries and the one anybody wants is the round just played.
    // Ascending would bury it at the bottom every week for nine months.
    const html = renderToStaticMarkup(<RoundPicker gameweeks={[1, 2, 3, 4]} selected={null} />);
    const labels = [...html.matchAll(/<option[^>]*>([^<]+)<\/option>/g)].map((m) => m[1]);
    expect(labels).toEqual(["Season total", "Round 4", "Round 3", "Round 2", "Round 1"]);
  });

  it("does not disturb the caller's array, which the form bars also read", () => {
    // `reverse()` mutates in place, so the copy is load-bearing: the standings page hands
    // over the same `played` array it slices the last three rounds from.
    const played = [1, 2, 3, 4];
    renderToStaticMarkup(<RoundPicker gameweeks={played} selected={null} />);
    expect(played).toEqual([1, 2, 3, 4]);
  });

  it("marks the chosen round as selected", () => {
    const html = renderToStaticMarkup(<RoundPicker gameweeks={[1, 2, 3]} selected={2} />);
    expect(html).toMatch(/<option[^>]*selected[^>]*>Round 2</);
  });

  it("selects the season total when no round is chosen", () => {
    const html = renderToStaticMarkup(<RoundPicker gameweeks={[1, 2]} selected={null} />);
    expect(html).toMatch(/<option[^>]*selected[^>]*>Season total</);
  });

  it("offers only the season total before any round has been played", () => {
    const html = renderToStaticMarkup(<RoundPicker gameweeks={[]} selected={null} />);
    expect(html).toContain("Season total");
    expect(html).not.toContain("Round ");
  });
});
