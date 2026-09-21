import { describe, expect, it } from "vitest";
import {
  MAX_VOTES,
  canCastFor,
  roundLeaders,
  haters,
  isOpen,
  mostHated,
  roundConsequences,
  roundLast,
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

describe("roundLast", () => {
  it("names every team level at the bottom, not the one the API put thirteenth", () => {
    // The owner's ruling, and a change from what shipped: this used to read the API's
    // `roundPosition` and so always named exactly one. Gameweek 4 in production is the
    // case — two teams level on 24, given positions 12 and 13 by a rule the API does not
    // publish. The positions are its arbitration; the points are the fact.
    expect(roundLast([snap("a", 50, 1), snap("b", 24, 12), snap("c", 24, 13)], 4)).toEqual([
      "b",
      "c",
    ]);
  });

  it("names one team when one is clearly worst", () => {
    expect(roundLast([snap("a", 50, 1), snap("b", 17, 2)], 4)).toEqual(["b"]);
  });

  it("sorts them, so a tie cannot reorder itself between loads", () => {
    expect(roundLast([snap("c", 24, 12), snap("a", 24, 13)], 4)).toEqual(["a", "c"]);
  });

  it("is empty while any position is still missing", () => {
    // A live round reports no rank within the round, so `roundPosition` is null. Scoring
    // then would be scoring a race that is still running. The position is still what says
    // the round has settled, even though the answer is read off the points.
    expect(roundLast([snap("a", 50, 1), snap("b", 10, null)], 4)).toEqual([]);
  });

  it("is empty when the round is provisional", () => {
    expect(roundLast([{ ...snap("a", 50, 1), isProvisional: true }, snap("b", 10, 2)], 4)).toEqual([]);
  });

  it("is empty for a round with nothing recorded", () => {
    expect(roundLast([], 4)).toEqual([]);
  });

  it("ignores other gameweeks", () => {
    const other = { ...snap("z", 1, 99), gameweek: 3 };
    expect(roundLast([other, snap("a", 50, 1), snap("b", 10, 2)], 4)).toEqual(["b"]);
  });
});

describe("roundLeaders", () => {
  it("names every team level at the top, not the one the API puts first", () => {
    // The owner's ruling: co-leaders count equally, even where the API hands one of them
    // first place. It breaks ties into distinct sequential positions by a rule it does
    // not publish, so the points are the only honest answer to who led the round.
    expect(roundLeaders([snap("a", 75, 1), snap("b", 75, 2), snap("c", 50, 3)], 4)).toEqual([
      "a",
      "b",
    ]);
  });

  it("names one leader when one team is clear", () => {
    // Round 5 in production: 75 against 53, no tie anywhere near the top.
    expect(roundLeaders([snap("a", 75, 1), snap("b", 53, 2)], 4)).toEqual(["a"]);
  });

  it("sorts the leaders, so a tie cannot reorder itself between loads", () => {
    expect(roundLeaders([snap("c", 75, 1), snap("a", 75, 2)], 4)).toEqual(["a", "c"]);
  });

  it("is empty under exactly the conditions last is unknown", () => {
    // The position is what says a round has SETTLED — a live response reports the overall
    // table place instead of a rank within the round. The points are what rank it. So the
    // guard still reads the position even though the answer never does.
    expect(roundLeaders([snap("a", 50, 1), snap("b", 10, null)], 4)).toEqual([]);
    expect(roundLeaders([{ ...snap("a", 50, 1), isProvisional: true }, snap("b", 10, 2)], 4)).toEqual([]);
    expect(roundLeaders([], 4)).toEqual([]);
  });

  it("ignores other gameweeks", () => {
    const other = { ...snap("z", 999, 1), gameweek: 3 };
    expect(roundLeaders([other, snap("a", 50, 1), snap("b", 10, 2)], 4)).toEqual(["a"]);
  });
});

describe("scoreRound", () => {
  it("gives a point for naming the team that finished last", () => {
    expect(scoreRound([ballot("t1", "a", "b")], ["b"])).toEqual(new Map([["t1", 1]]));
  });

  it("gives the same point whichever of the two slots holds it", () => {
    expect(scoreRound([ballot("t1", "b", "a")], ["b"])).toEqual(new Map([["t1", 1]]));
  });

  it("gives one point, not two, and never more than one per round", () => {
    // The rule is "one point only if the actual last-placed team is among them".
    expect(scoreRound([ballot("t1", "b", null)], ["b"])).toEqual(new Map([["t1", 1]]));
  });

  it("gives one point for naming either of two teams level at the bottom, never two", () => {
    // The owner's ruling puts several teams last on a tie. A voter who named both of
    // them still guessed one thing right, so a tied week must not double the prize.
    expect(scoreRound([ballot("t1", "b", "c")], ["b", "c"])).toEqual(new Map([["t1", 1]]));
    expect(scoreRound([ballot("t1", "b", "z")], ["b", "c"])).toEqual(new Map([["t1", 1]]));
    expect(scoreRound([ballot("t1", "c", "z")], ["b", "c"])).toEqual(new Map([["t1", 1]]));
  });

  it("gives nothing for missing", () => {
    expect(scoreRound([ballot("t1", "a", "c")], ["b"])).toEqual(new Map([["t1", 0]]));
  });

  it("scores nobody at all when the round is unresolved", () => {
    // Deliberately empty rather than everyone on zero: "nobody guessed right" and "we do
    // not know yet" are different claims, and a season table must not average them.
    expect(scoreRound([ballot("t1", "a", "b")], [])).toEqual(new Map());
  });
});

describe("seasonTable", () => {
  const rounds = [
    { gameweek: 4, lastTeamIds: ["b"] },
    { gameweek: 5, lastTeamIds: ["c"] },
    // Unresolved: still being played, and must contribute nothing either way.
    { gameweek: 6, lastTeamIds: [] },
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
    const rows = roundBallots(voters, cast, 4, []);
    expect(rows.map((r) => [r.name, r.picks])).toEqual([
      ["Ada", ["a", "b"]],
      ["Bruno", ["c"]],
      ["Cleo", []],
    ]);
  });

  it("keeps a manager who has not voted, rather than leaving them out", () => {
    // "Nobody has heard from Cleo" is as much of a prod as the picks themselves, and an
    // absence shown as an absence cannot be read as a manager who does not play.
    const rows = roundBallots(voters, cast, 4, []);
    expect(rows.find((r) => r.name === "Cleo")).toMatchObject({ picks: [] });
  });

  it("marks who named the team that finished last", () => {
    const rows = roundBallots(voters, cast, 4, ["b"]);
    expect(rows.find((r) => r.name === "Ada")?.hit).toBe(true);
    expect(rows.find((r) => r.name === "Bruno")?.hit).toBe(false);
  });

  it("marks nobody while the round is undecided", () => {
    expect(roundBallots(voters, cast, 4, []).every((r) => !r.hit)).toBe(true);
  });

  it("reads only the round asked for", () => {
    const rows = roundBallots(voters, cast, 5, []);
    expect(rows.find((r) => r.name === "Cleo")?.picks).toEqual(["a"]);
    expect(rows.find((r) => r.name === "Ada")?.picks).toEqual([]);
  });

  it("is every voter and nothing else when a round has no ballots at all", () => {
    expect(roundBallots(voters, [], 9, []).map((r) => r.picks)).toEqual([[], [], []]);
  });

  it("returns a team nobody has claimed, so an absent manager is still a row", () => {
    // The whole point of the re-key. Before it, "everyone" meant everyone with an
    // account, and the two managers who vote in the group chat were not in the list at
    // all — not shown as silent, simply absent.
    const unclaimed = [...voters, { teamId: "t9", name: "Dani" }];
    const rows = roundBallots(unclaimed, cast, 4, []);
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
    const rows = roundBallots(voters, entered, 4, []);
    expect(rows.find((r) => r.name === "Cleo")).toMatchObject({ enteredBy: "u-admin", castAt });
    expect(rows.find((r) => r.name === "Ada")?.enteredBy).toBeNull();
  });

  it("does not disturb the caller's voter array", () => {
    const original = [...voters];
    roundBallots(voters, cast, 4, []);
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

describe("roundConsequences", () => {
  const at = (gameweek: number, voter: string, first: string, second: string | null = null) => ({
    ...ballot(voter, first, second),
    gameweek,
  });
  const ends = (firstTeamIds: string[], lastTeamIds: string[]) => ({
    firstTeamIds,
    lastTeamIds,
  });

  it("names whoever picked the team that went on to win", () => {
    // The whole point of the poll is calling the bottom. Calling the top instead is the
    // furthest you can be from right, and the league charges an apology for it.
    const result = roundConsequences(
      [at(4, "b", "a"), at(4, "c", "d"), at(4, "d", "a", "b")],
      4,
      ends(["a"], ["d"]),
    );
    expect(result.apologists).toEqual(["b", "d"]);
  });

  it("sorts the apologists, because the sentence reads them out in order", () => {
    // Undefined row order from the database would swap two names between loads. Same
    // reason `breakfastDuties` sorts its bringers.
    expect(roundConsequences([at(4, "d", "a"), at(4, "b", "a")], 4, ends(["a"], ["c"])).apologists).toEqual(
      ["b", "d"],
    );
  });

  it("earns the manager who won the round and called the bottom the right to denigrate", () => {
    // Both halves of the Constitution's fourth article at once: `a` finished the round
    // first AND named `d`, who finished it last.
    const result = roundConsequences([at(4, "a", "d")], 4, ends(["a"], ["d"]));
    expect(result.denigrations).toEqual([{ senderTeamId: "a", targetTeamIds: ["d"] }]);
    expect(result.winnerTeamIds).toEqual(["a"]);
  });

  it("earns nothing for calling the bottom without winning the round", () => {
    // Calling it right is already worth a point in the poll. The right to use it is the
    // winner's alone.
    expect(roundConsequences([at(4, "b", "d")], 4, ends(["a"], ["d"])).denigrations).toEqual([]);
  });

  it("earns nothing for winning the round having called the bottom wrongly", () => {
    expect(roundConsequences([at(4, "a", "c")], 4, ends(["a"], ["d"])).denigrations).toEqual([]);
  });

  it("earns nothing for a winner who did not vote at all", () => {
    expect(roundConsequences([at(4, "b", "d")], 4, ends(["a"], ["d"])).denigrations).toEqual([]);
  });

  it("hands each winner only the team they named themselves", () => {
    // Two co-leaders, two teams level at the bottom, and each winner named one of them.
    // Pairing sender to target is what stops a winner denigrating a team they never
    // called — and it is also why a winner can never denigrate themselves: nobody may
    // vote for their own team.
    const result = roundConsequences(
      [at(4, "a", "d"), at(4, "e", "f")],
      4,
      ends(["a", "e"], ["d", "f"]),
    );
    expect(result.denigrations).toEqual([
      { senderTeamId: "a", targetTeamIds: ["d"] },
      { senderTeamId: "e", targetTeamIds: ["f"] },
    ]);
  });

  it("gives a winner who named both of two teams level at the bottom both of them", () => {
    const result = roundConsequences([at(4, "a", "f", "d")], 4, ends(["a"], ["d", "f"]));
    expect(result.denigrations).toEqual([{ senderTeamId: "a", targetTeamIds: ["d", "f"] }]);
  });

  it("sorts the senders, because the sentences are read out in order", () => {
    const result = roundConsequences(
      [at(4, "e", "d"), at(4, "a", "d")],
      4,
      ends(["a", "e"], ["d"]),
    );
    expect(result.denigrations.map((one) => one.senderTeamId)).toEqual(["a", "e"]);
  });

  it("counts the bottom named in either slot", () => {
    expect(
      roundConsequences([at(4, "a", "c", "d")], 4, ends(["a"], ["d"])).denigrations,
    ).toEqual([{ senderTeamId: "a", targetTeamIds: ["d"] }]);
  });

  it("charges an apology and earns a denigration from one ballot, when both apply", () => {
    // Rare but reachable: with two teams level at the top, a winner can name the other
    // winner with one pick and the bottom with the other. The two verdicts are
    // independent, so the ballot collects both.
    const result = roundConsequences([at(4, "a", "e", "d")], 4, ends(["a", "e"], ["d"]));
    expect(result.apologists).toEqual(["a"]);
    expect(result.denigrations).toEqual([{ senderTeamId: "a", targetTeamIds: ["d"] }]);
  });

  it("finds nobody in a round that is not decided", () => {
    // "Not yet" is not "nobody owed anything" — but neither is it a verdict, so the fold
    // returns an empty one rather than guessing at either.
    const result = roundConsequences([at(4, "b", "a")], 4, ends([], []));
    expect(result).toEqual({ apologists: [], denigrations: [], winnerTeamIds: [] });
  });

  it("charges an apology for naming either of two co-leaders", () => {
    // The owner's ruling: co-leaders count equally. Naming one of them is naming a
    // winner, whichever one the API decided to print first.
    const result = roundConsequences(
      [at(4, "b", "a"), at(4, "c", "d"), at(4, "e", "f")],
      4,
      ends(["a", "d"], []),
    );
    expect(result.apologists).toEqual(["b", "c"]);
  });

  it("ignores ballots from other rounds", () => {
    expect(roundConsequences([at(3, "b", "a")], 4, ends(["a"], ["d"])).apologists).toEqual([]);
  });

  it("counts a winner named in either slot", () => {
    expect(roundConsequences([at(4, "b", "c", "a")], 4, ends(["a"], ["d"])).apologists).toEqual(["b"]);
  });
});
