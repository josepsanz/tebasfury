import { describe, expect, it } from "vitest";
import { SHIELD_ROUNDS } from "./breakfast";
import { HOLD_HOURS } from "./market";
import {
  ARTICLES,
  ENTRY_FEE_EUROS,
  PRIZE_SHARES,
  articleOn,
  formatEuros,
  prizePot,
} from "./constitution";

/**
 * The law, and the code that enforces it, saying the same thing.
 *
 * Every assertion below compares WRITTEN PROSE against a constant the portal computes
 * with. That is the whole point of this file: the articles are written out in words, so
 * nothing stops them drifting from the arithmetic except a test that reads both. Change
 * `SHIELD_ROUNDS` to 2 and the shield article becomes a lie — here is where that is
 * caught.
 */
describe("the articles", () => {
  it("numbers them 1 upwards, with no gap and no repeat", () => {
    expect(ARTICLES.map((article) => article.number)).toEqual(
      ARTICLES.map((_, i) => i + 1),
    );
  });

  it("states the stake and the split the page pays out with", () => {
    const body = articleOn("stakes").body.join(" ");
    expect(body).toContain(`${ENTRY_FEE_EUROS} €`);
    for (const share of PRIZE_SHARES) expect(body).toContain(`${share} %`);
  });

  it("states the breakfast shield as the number of rounds the code shields for", () => {
    expect(articleOn("breakfast").body.join(" ")).toContain(`${SHIELD_ROUNDS} rounds`);
  });

  it("states the holding rule as the number of days the code holds for", () => {
    expect(articleOn("holding").body.join(" ")).toContain(`${HOLD_HOURS / 24} days`);
  });

  it("sends the reader to the page that applies each article it has one for", () => {
    expect(articleOn("breakfast").appliedAt?.href).toBe("/standings");
    expect(articleOn("apology").appliedAt?.href).toBe("/necroporra");
    expect(articleOn("denigration").appliedAt?.href).toBe("/necroporra");
    expect(articleOn("holding").appliedAt?.href).toBe("/fair-play");
    // The stake is the one article no page enforces: nobody has ever paid a manager
    // through this portal, and a link to a page that cannot settle up would lie.
    expect(articleOn("stakes").appliedAt).toBeNull();
  });
});

describe("the pot", () => {
  it("is the entry fee from every manager", () => {
    expect(prizePot(13).potCents).toBe(13 * ENTRY_FEE_EUROS * 100);
  });

  it("pays the three places their share, with nothing left in the pot", () => {
    const { potCents, prizes } = prizePot(13);
    expect(prizes.map((prize) => prize.share)).toEqual([...PRIZE_SHARES]);
    expect(prizes.map((prize) => prize.cents)).toEqual([12_675, 4_875, 1_950]);
    expect(prizes.reduce((sum, prize) => sum + prize.cents, 0)).toBe(potCents);
  });

  it("leaves nothing over for any size of league", () => {
    // Every share is a multiple of 5 % of a whole number of euros, so the division is
    // exact — but it is exact by arithmetic rather than by rounding, and a future fee of
    // 12.50 € would break it silently. This is the test that would notice.
    for (let teams = 0; teams <= 30; teams++) {
      const { potCents, prizes } = prizePot(teams);
      expect(prizes.reduce((sum, prize) => sum + prize.cents, 0)).toBe(potCents);
    }
  });

  it("pays nobody in a league with no managers", () => {
    const { potCents, prizes } = prizePot(0);
    expect(potCents).toBe(0);
    expect(prizes.every((prize) => prize.cents === 0)).toBe(true);
  });
});

describe("the league's money", () => {
  it("writes euros the way the league says them, with the sign after the figure", () => {
    expect(formatEuros(12_675)).toBe("126.75 €");
  });

  it("keeps the cents on a round figure, so a column of prizes lines up", () => {
    expect(formatEuros(1_950)).toBe("19.50 €");
    expect(formatEuros(0)).toBe("0.00 €");
  });
});
