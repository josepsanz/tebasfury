import { describe, expect, it } from "vitest";
import {
  MAX_VOTES,
  canCastFor,
  haters,
  isOpen,
  mostHated,
  lastPlaced,
  roundBallots,
  scoreRound,
  seasonTable,
  validatePair,
  type Ballot,
} from "./necroporra";
import type { Snapshot } from "./standings";

const CAST_AT = new Date("2026-09-10T12:00:00Z");

const snap = (teamId: string, points: number, roundPosition: number | null): Snapshot => ({
  teamId,
  gameweek: 4,
  points,
  roundPosition,
  livePoints: null,
  isProvisional: false,
  teamValue: null,
});

const ballot = (teamId: string, first: string | null, second: string | null = null): Ballot => ({
  gameweek: 4,
  teamId,
  firstTeamId: first,
  secondTeamId: second,
  enteredBy: null,
  castAt: CAST_AT,
});

describe("isOpen", () => {
  const closesAt = new Date("2026-09-11T19:00:00Z");

  it("is open before the round kicks off", () => {
    expect(isOpen({ gameweek: 5, closesAt }, new Date("2026-09-10T12:00:00Z"))).toBe(true);
  });

  it("is shut once it kicks off, and the instant counts as shut", () => {
    // The deadline is the kickoff itself. A vote landing on the same millisecond as the
    // whistle is late, not early — and "late" is the safe direction for a poll whose
    // whole point is committing before you know anything.
    expect(isOpen({ gameweek: 5, closesAt }, closesAt)).toBe(false);
    expect(isOpen({ gameweek: 5, closesAt }, new Date("2026-09-11T19:00:01Z"))).toBe(false);
  });

  it("is shut when there is no round at all", () => {
    expect(isOpen(null, new Date())).toBe(false);
  });
});

describe("validatePair", () => {
  const teams = ["a", "b", "c"];

  it("accepts two different teams that are not yours", () => {
    expect(validatePair(["a", "b"], { ownTeamId: "c", teamIds: teams })).toEqual({ ok: true });
  });

  it("accepts a single pick, for a voter who only wants to name one", () => {
    expect(validatePair(["a"], { ownTeamId: "c", teamIds: teams })).toEqual({ ok: true });
  });

  it("refuses your own team", () => {
    expect(validatePair(["a", "c"], { ownTeamId: "c", teamIds: teams })).toEqual({
      ok: false,
      reason: "own-team",
    });
  });

  it("refuses the same team named twice", () => {
    // One vote wearing two hats, which would read on the page as a voter who had spent
    // both picks.
    expect(validatePair(["a", "a"], { ownTeamId: "c", teamIds: teams })).toEqual({
      ok: false,
      reason: "duplicate",
    });
  });

  it("refuses more picks than the rule allows", () => {
    expect(validatePair(["a", "b", "c"], { ownTeamId: "z", teamIds: [...teams, "z"] })).toEqual({
      ok: false,
      reason: "too-many",
    });
  });

  it("refuses a team that is not in the league", () => {
    expect(validatePair(["a", "ghost"], { ownTeamId: "c", teamIds: teams })).toEqual({
      ok: false,
      reason: "unknown-team",
    });
  });

  it("refuses an empty ballot, which is not the same as not voting", () => {
    expect(validatePair([], { ownTeamId: "c", teamIds: teams })).toEqual({
      ok: false,
      reason: "empty",
    });
  });

  it("allows a voter with no team of their own to be validated against nothing", () => {
    // The page refuses these voters earlier and for a different reason; the rule itself
    // must not crash on a null.
    expect(validatePair(["a"], { ownTeamId: null, teamIds: teams })).toEqual({ ok: true });
  });

  it("states the rule it enforces", () => {
    expect(MAX_VOTES).toBe(2);
  });
});

describe("lastPlaced", () => {
  it("is the team the API put last, not the one we would rank last", () => {
    // Measured 2026-09-09: where teams tie, the API hands out distinct sequential places
    // and a derived rank shares them. Deriving would make "last" ambiguous exactly when
    // two teams tie at the bottom — which is the week it matters most.
    const team = lastPlaced(
      [snap("a", 50, 1), snap("b", 24, 12), snap("c", 24, 13)],
      4,
    );
    expect(team).toBe("c");
  });

  it("is unknown while any position is still missing", () => {
    // A live round reports no rank within the round, so `roundPosition` is null. Scoring
    // then would be scoring a race that is still running.
    expect(lastPlaced([snap("a", 50, 1), snap("b", 10, null)], 4)).toBeNull();
  });

  it("is unknown when the round is provisional", () => {
    const provisional = [{ ...snap("a", 50, 1), isProvisional: true }, snap("b", 10, 2)];
    expect(lastPlaced(provisional, 4)).toBeNull();
  });

  it("is unknown for a round with nothing recorded", () => {
    expect(lastPlaced([], 4)).toBeNull();
  });

  it("ignores other gameweeks", () => {
    const other = { ...snap("z", 1, 99), gameweek: 3 };
    expect(lastPlaced([other, snap("a", 50, 1), snap("b", 10, 2)], 4)).toBe("b");
  });
});

describe("scoreRound", () => {
  it("gives a point for naming the team that finished last", () => {
    expect(scoreRound([ballot("t1", "a", "b")], "b")).toEqual(new Map([["t1", 1]]));
  });

  it("gives the same point whichever of the two slots holds it", () => {
    expect(scoreRound([ballot("t1", "b", "a")], "b")).toEqual(new Map([["t1", 1]]));
  });

  it("gives one point, not two, and never more than one per round", () => {
    // The rule is "one point only if the actual last-placed team is among them".
    expect(scoreRound([ballot("t1", "b", null)], "b")).toEqual(new Map([["t1", 1]]));
  });

  it("gives nothing for missing", () => {
    expect(scoreRound([ballot("t1", "a", "c")], "b")).toEqual(new Map([["t1", 0]]));
  });

  it("scores nobody at all when the round is unresolved", () => {
    // Deliberately empty rather than everyone on zero: "nobody guessed right" and "we do
    // not know yet" are different claims, and a season table must not average them.
    expect(scoreRound([ballot("t1", "a", "b")], null)).toEqual(new Map());
  });
});

describe("seasonTable", () => {
  const rounds = [
    { gameweek: 4, lastTeamId: "b" as string | null },
    { gameweek: 5, lastTeamId: "c" as string | null },
    // Unresolved: still being played, and must contribute nothing either way.
    { gameweek: 6, lastTeamId: null },
  ];
  const ballots: Ballot[] = [
    { gameweek: 4, teamId: "t1", firstTeamId: "b", secondTeamId: "a", enteredBy: null, castAt: CAST_AT },
    { gameweek: 5, teamId: "t1", firstTeamId: "c", secondTeamId: "a", enteredBy: null, castAt: CAST_AT },
    { gameweek: 6, teamId: "t1", firstTeamId: "a", secondTeamId: "b", enteredBy: null, castAt: CAST_AT },
    { gameweek: 4, teamId: "t2", firstTeamId: "a", secondTeamId: "c", enteredBy: null, castAt: CAST_AT },
    { gameweek: 5, teamId: "t2", firstTeamId: "c", secondTeamId: "a", enteredBy: null, castAt: CAST_AT },
  ];

  it("sums points across resolved rounds only", () => {
    const table = seasonTable(ballots, rounds, new Map([["t1", "Ada"], ["t2", "Bruno"]]));
    expect(table.map((r) => [r.teamId, r.points, r.rounds])).toEqual([
      ["t1", 2, 2],
      ["t2", 1, 2],
    ]);
  });

  it("counts rounds voted in, not rounds played, so a late joiner is not punished silently", () => {
    const table = seasonTable(
      [{ gameweek: 4, teamId: "t3", firstTeamId: "b", secondTeamId: null, enteredBy: null, castAt: CAST_AT }],
      rounds,
      new Map([["t3", "Cleo"]]),
    );
    expect(table[0]).toMatchObject({ points: 1, rounds: 1 });
  });

  it("breaks a tie on the name, so the order never wobbles between renders", () => {
    const table = seasonTable(
      [
        { gameweek: 4, teamId: "tz", firstTeamId: "b", secondTeamId: null, enteredBy: null, castAt: CAST_AT },
        { gameweek: 4, teamId: "ta", firstTeamId: "b", secondTeamId: null, enteredBy: null, castAt: CAST_AT },
      ],
      rounds,
      new Map([["tz", "Zoe"], ["ta", "Ada"]]),
    );
    expect(table.map((r) => r.name)).toEqual(["Ada", "Zoe"]);
  });

  it("scores a ballot an admin entered exactly like one its manager cast", () => {
    const table = seasonTable(
      [
        {
          gameweek: 4,
          teamId: "t1",
          firstTeamId: "b",
          secondTeamId: null,
          enteredBy: "u-admin",
          castAt: CAST_AT,
        },
      ],
      rounds,
      new Map([["t1", "Ada"]]),
    );
    expect(table).toEqual([{ teamId: "t1", name: "Ada", points: 1, rounds: 1 }]);
  });

  it("is empty before anybody has voted", () => {
    expect(seasonTable([], rounds, new Map())).toEqual([]);
  });
});

describe("roundBallots", () => {
  const voters = [
    { teamId: "t2", name: "Bruno" },
    { teamId: "t1", name: "Ada" },
    { teamId: "t3", name: "Cleo" },
  ];
  const cast = [
    { gameweek: 4, teamId: "t1", firstTeamId: "a", secondTeamId: "b", enteredBy: null, castAt: CAST_AT },
    { gameweek: 4, teamId: "t2", firstTeamId: "c", secondTeamId: null, enteredBy: null, castAt: CAST_AT },
    { gameweek: 5, teamId: "t3", firstTeamId: "a", secondTeamId: null, enteredBy: null, castAt: CAST_AT },
  ];

  it("shows every manager's picks, in name order", () => {
    const rows = roundBallots(voters, cast, 4, null);
    expect(rows.map((r) => [r.name, r.picks])).toEqual([
      ["Ada", ["a", "b"]],
      ["Bruno", ["c"]],
      ["Cleo", []],
    ]);
  });

  it("keeps a manager who has not voted, rather than leaving them out", () => {
    // "Nobody has heard from Cleo" is as much of a prod as the picks themselves, and an
    // absence shown as an absence cannot be read as a manager who does not play.
    const rows = roundBallots(voters, cast, 4, null);
    expect(rows.find((r) => r.name === "Cleo")).toMatchObject({ picks: [] });
  });

  it("marks who named the team that finished last", () => {
    const rows = roundBallots(voters, cast, 4, "b");
    expect(rows.find((r) => r.name === "Ada")?.hit).toBe(true);
    expect(rows.find((r) => r.name === "Bruno")?.hit).toBe(false);
  });

  it("marks nobody while the round is undecided", () => {
    expect(roundBallots(voters, cast, 4, null).every((r) => !r.hit)).toBe(true);
  });

  it("reads only the round asked for", () => {
    const rows = roundBallots(voters, cast, 5, null);
    expect(rows.find((r) => r.name === "Cleo")?.picks).toEqual(["a"]);
    expect(rows.find((r) => r.name === "Ada")?.picks).toEqual([]);
  });

  it("is every voter and nothing else when a round has no ballots at all", () => {
    expect(roundBallots(voters, [], 9, null).map((r) => r.picks)).toEqual([[], [], []]);
  });

  it("returns a team nobody has claimed, so an absent manager is still a row", () => {
    // The whole point of the re-key. Before it, "everyone" meant everyone with an
    // account, and the two managers who vote in the group chat were not in the list at
    // all — not shown as silent, simply absent.
    const unclaimed = [...voters, { teamId: "t9", name: "Dani" }];
    const rows = roundBallots(unclaimed, cast, 4, null);
    expect(rows.find((r) => r.name === "Dani")).toMatchObject({ teamId: "t9", picks: [] });
  });

  it("carries who entered a ballot, and when, through to the row", () => {
    // The date is half the mark. An entered ballot may legitimately be typed after the
    // round closed, so "when" is what lets the league see the privilege being used.
    const castAt = new Date("2026-09-12T10:30:00Z");
    const entered = [
      {
        gameweek: 4,
        teamId: "t3",
        firstTeamId: "c",
        secondTeamId: null,
        enteredBy: "u-admin",
        castAt,
      },
    ];
    const rows = roundBallots(voters, entered, 4, null);
    expect(rows.find((r) => r.name === "Cleo")).toMatchObject({ enteredBy: "u-admin", castAt });
    expect(rows.find((r) => r.name === "Ada")?.enteredBy).toBeNull();
  });

  it("does not disturb the caller's voter array", () => {
    const original = [...voters];
    roundBallots(voters, cast, 4, null);
    expect(voters).toEqual(original);
  });
});

describe("canCastFor", () => {
  it("lets a manager cast for their own team", () => {
    expect(canCastFor({ teamId: "t1", mayCastForOthers: false }, "t1")).toBe(true);
  });

  it("refuses a manager casting for somebody else", () => {
    expect(canCastFor({ teamId: "t1", mayCastForOthers: false }, "t2")).toBe(false);
  });

  it("lets an admin cast for any team", () => {
    expect(canCastFor({ teamId: "t1", mayCastForOthers: true }, "t2")).toBe(true);
  });

  it("lets an admin with no team of their own cast for a team", () => {
    // The portal's owner need not be a manager — and in this league, is not. An admin who
    // has claimed nothing still has to be able to enter what the group chat said.
    expect(canCastFor({ teamId: null, mayCastForOthers: true }, "t2")).toBe(true);
  });

  it("refuses somebody with neither a team nor the permission", () => {
    expect(canCastFor({ teamId: null, mayCastForOthers: false }, "t2")).toBe(false);
  });
});

describe("mostHated", () => {
  const names = new Map([
    ["a", "Ada"],
    ["b", "Bruno"],
    ["c", "Chus"],
    ["d", "Dídac"],
  ]);

  /** A ballot in a named round, so several rounds can be piled up. */
  const at = (gameweek: number, voter: string, first: string, second: string | null = null) => ({
    ...ballot(voter, first, second),
    gameweek,
  });

  it("counts every vote a team has received, all season and both picks", () => {
    // Two picks a round means a team can be named twice over in one week by two voters,
    // and the tally is of votes and not of voters.
    const rows = mostHated(
      [at(1, "a", "c", "b"), at(1, "b", "c"), at(2, "a", "c"), at(2, "b", "d")],
      names,
    );
    expect(rows.map((r) => [r.name, r.votes])).toEqual([
      ["Chus", 3],
      ["Bruno", 1],
      ["Dídac", 1],
      ["Ada", 0],
    ]);
  });

  it("keeps a team nobody has ever named, on nought", () => {
    // Absence would read as missing data. Nought is the interesting fact: a whole season
    // and not one person thinks you are the worst.
    const rows = mostHated([at(1, "a", "c")], names);
    expect(rows.find((r) => r.name === "Ada")).toEqual({ teamId: "a", name: "Ada", votes: 0 });
  });

  it("breaks a tie on the name, so the order cannot wobble between renders", () => {
    // The same habit `rankAt` and `seasonTable` keep. Bruno and Dídac both on one.
    const rows = mostHated([at(1, "a", "b"), at(1, "c", "d")], names);
    expect(rows.map((r) => r.name)).toEqual(["Bruno", "Dídac", "Ada", "Chus"]);
  });

  it("counts an open round's votes too, because the page already shows them", () => {
    // "Everyone's picks so far" prints the open round's ballots as they land, so there is
    // no secret for this tally to leak — and "so far" is what was asked for.
    expect(mostHated([at(9, "a", "c")], names).find((r) => r.name === "Chus")?.votes).toBe(1);
  });
});

describe("haters", () => {
  const names = new Map([
    ["a", "Ada"],
    ["b", "Bruno"],
    ["c", "Chus"],
  ]);

  const at = (gameweek: number, voter: string, first: string, second: string | null = null) => ({
    ...ballot(voter, first, second),
    gameweek,
  });

  it("names who has picked you, most often first", () => {
    const rows = haters([at(1, "a", "c"), at(2, "a", "c"), at(1, "b", "c")], "c", names);
    expect(rows.map((r) => [r.name, r.votes])).toEqual([
      ["Ada", 2],
      ["Bruno", 1],
    ]);
  });

  it("leaves out everyone who never picked you", () => {
    // The league table shows noughts; this list does not. It answers "who has it in for
    // me", and a row saying somebody has named you no times is not an answer to that.
    const rows = haters([at(1, "a", "c"), at(1, "b", "a")], "c", names);
    expect(rows.map((r) => r.name)).toEqual(["Ada"]);
  });

  it("counts a ballot once even when it names you and somebody else", () => {
    const rows = haters([at(1, "a", "c", "b")], "c", names);
    expect(rows).toEqual([{ teamId: "a", name: "Ada", votes: 1 }]);
  });

  it("is empty for a team nobody has named", () => {
    expect(haters([at(1, "a", "b")], "c", names)).toEqual([]);
  });
});
