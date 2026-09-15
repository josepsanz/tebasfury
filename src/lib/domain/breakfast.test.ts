import { describe, expect, it } from "vitest";
import { breakfastDuties, dutyFor, SHIELD_ROUNDS } from "./breakfast";
import type { Snapshot } from "./standings";

const snap = (teamId: string, gameweek: number, points: number, over: Partial<Snapshot> = {}): Snapshot => ({
  teamId,
  gameweek,
  points,
  roundPosition: 1,
  livePoints: null,
  isProvisional: false,
  teamValue: null,
  ...over,
});

/** Three teams, one round, lowest last. */
const round = (gameweek: number, points: Record<string, number>): Snapshot[] =>
  Object.entries(points).map(([teamId, p]) => snap(teamId, gameweek, p));

describe("breakfastDuties", () => {
  it("names the team with the fewest points in the round", () => {
    const duties = breakfastDuties(round(1, { a: 40, b: 30, c: 20 }));
    expect(duties).toEqual([{ gameweek: 1, bringers: ["c"], shielded: [] }]);
  });

  it("names EVERY team tied at the bottom", () => {
    // The rule's own words, and the reason this is computed from points: the API breaks
    // a tie into distinct places by a rule it does not publish, so a position would pick
    // one of these two and the league would be short a breakfast.
    const duties = breakfastDuties(round(1, { a: 40, b: 20, c: 20 }));
    expect(duties[0].bringers.slice().sort()).toEqual(["b", "c"]);
  });

  it("walks up the table past a shielded team", () => {
    // `c` brings it in round 1 and is covered in 2, 3 and 4. It finishes last again in
    // round 2, so the bag passes to whoever is lowest among the rest.
    const duties = breakfastDuties([
      ...round(1, { a: 40, b: 30, c: 20 }),
      ...round(2, { a: 40, b: 25, c: 10 }),
    ]);
    expect(duties[1]).toMatchObject({ gameweek: 2, bringers: ["b"] });
  });

  it("keeps walking while the teams above are shielded too", () => {
    const duties = breakfastDuties([
      ...round(1, { a: 40, b: 30, c: 20 }),
      ...round(2, { a: 40, b: 25, c: 10 }),
      ...round(3, { a: 40, b: 25, c: 10 }),
    ]);
    // Round 3: `c` shielded from round 1, `b` shielded from round 2, so `a` brings it
    // despite being top of the round every week.
    expect(duties[2]).toMatchObject({ gameweek: 3, bringers: ["a"] });
  });

  it("exposes a team again once its three rounds are up", () => {
    // Five teams, identical every round, so the only thing that moves is the shields.
    // e brings it in round 1 and is covered in 2, 3 and 4 — so the bag walks up the table,
    // d then c then b — and in round 5 e's shield has expired and e is named again. Three
    // teams could not show this: with a three-round shield they are all covered at once by
    // round 4, and every round after that is a full yield rather than an expiry.
    const rounds = [1, 2, 3, 4, 5]
      .map((gw) => round(gw, { a: 50, b: 40, c: 30, d: 20, e: 10 }))
      .flat();
    const duties = breakfastDuties(rounds);
    expect(duties.map((d) => d.bringers)).toEqual([["e"], ["d"], ["c"], ["b"], ["e"]]);
  });

  it("reports who a shield is protecting, and for how many more rounds", () => {
    const duties = breakfastDuties([
      ...round(1, { a: 40, b: 30, c: 20 }),
      ...round(2, { a: 40, b: 30, c: 20 }),
    ]);
    // In round 2, `c`'s shield still covers 2, 3 and 4 — three rounds counting this one.
    expect(duties[1].shielded).toEqual([{ teamId: "c", roundsLeft: SHIELD_ROUNDS }]);
  });

  it("yields the shield rather than letting a round pass with nobody", () => {
    // Somebody always brings breakfast. Two teams, both shielded by rounds 1 and 2, and
    // round 3 still has to name somebody — so the shields give way and the bottom brings
    // it. Impossible with thirteen teams; the rule still has no "nobody" in it.
    const duties = breakfastDuties([
      ...round(1, { a: 30, b: 20 }),
      ...round(2, { a: 20, b: 30 }),
      ...round(3, { a: 30, b: 20 }),
    ]);
    expect(duties[2].bringers).toEqual(["b"]);
  });

  it("ignores a round still being played", () => {
    // No last place exists yet: the response reports the overall position rather than a
    // rank within the round, and the points are still climbing. `lastPlaced` refuses the
    // same question in the same words.
    const live = round(2, { a: 40, b: 30, c: 20 }).map((s) => ({ ...s, roundPosition: null }));
    const duties = breakfastDuties([...round(1, { a: 40, b: 30, c: 20 }), ...live]);
    expect(duties.map((d) => d.gameweek)).toEqual([1]);
  });

  it("ignores a provisional round, which is the same claim by another name", () => {
    const provisional = round(2, { a: 40, b: 30, c: 20 }).map((s) => ({ ...s, isProvisional: true }));
    expect(breakfastDuties(provisional)).toEqual([]);
  });

  it("leaves a team with no row for the round out of it", () => {
    // Being unlisted is not the same as finishing last, and the round table already
    // treats an absent team that way.
    const duties = breakfastDuties([snap("a", 1, 40), snap("b", 1, 30)]);
    expect(duties[0].bringers).toEqual(["b"]);
  });

  it("works the rounds out oldest first, whatever order the snapshots arrive in", () => {
    const shuffled = [...round(2, { a: 40, c: 10 }), ...round(1, { a: 40, c: 20 })];
    expect(breakfastDuties(shuffled).map((d) => d.gameweek)).toEqual([1, 2]);
  });
});

describe("dutyFor", () => {
  it("finds the round asked for", () => {
    const duties = breakfastDuties(round(4, { a: 40, b: 20 }));
    expect(dutyFor(duties, 4)?.bringers).toEqual(["b"]);
  });

  it("is null for a round with no duty, which is how a live round reads", () => {
    expect(dutyFor([], 6)).toBeNull();
  });
});
