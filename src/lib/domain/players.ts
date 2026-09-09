export type PlayerRecord = {
  id: string;
  nickname: string;
  position: string;
  realTeamId: string;
  status: string;
  imageUrl: string | null;
};

/** Aggregated in SQL, not in here: by May this is six hundred players times thirty-eight weeks. */
export type PlayerTotals = { playerId: string; seasonPoints: number; gameweeksRecorded: number };

export type CurrentValue = { playerId: string; value: number; takenOn: string };
export type Ownership = { playerId: string; teamId: string; managerName: string };

/** A club, as the catalogue needs it. Slug and badge stay in the database — Ruling 3. */
export type RealTeamRecord = { id: string; name: string };

export type ValuePoint = { takenOn: string; value: number };
export type GameweekPoints = { gameweek: number; points: number };

export type CatalogueRow = {
  id: string;
  nickname: string;
  position: string;
  status: string;
  /** Null until the first sweep records one. Not zero: zero would be a claim. */
  currentValue: number | null;
  seasonPoints: number;
  /** Points per gameweek recorded for this player; null when none are. */
  averagePoints: number | null;
  /** The denominator behind `averagePoints`. See `sortCatalogue`'s "average" key. */
  gameweeksRecorded: number;
  ownerTeamId: string | null;
  ownerName: string | null;
  /** Null when no squad response has yet named this player's club. See Ruling 1. */
  clubName: string | null;
};

/**
 * Everything the catalogue view shows, joined.
 *
 * Season totals and averages are DERIVED here rather than stored. The API states both,
 * and storing them alongside the per-gameweek series would let the two disagree — and
 * the series is the half that cannot be recomputed.
 */
export function buildCatalogue(input: {
  players: PlayerRecord[];
  totals: PlayerTotals[];
  values: CurrentValue[];
  ownership: Ownership[];
  clubs: RealTeamRecord[];
}): CatalogueRow[] {
  const totals = new Map(input.totals.map((t) => [t.playerId, t]));
  const values = new Map(input.values.map((v) => [v.playerId, v]));
  const owners = new Map(input.ownership.map((o) => [o.playerId, o]));
  const clubs = new Map(input.clubs.map((c) => [c.id, c.name]));

  return input.players.map((player) => {
    const total = totals.get(player.id);
    const owner = owners.get(player.id) ?? null;
    return {
      id: player.id,
      nickname: player.nickname,
      position: player.position,
      status: player.status,
      currentValue: values.get(player.id)?.value ?? null,
      seasonPoints: total?.seasonPoints ?? 0,
      averagePoints:
        total && total.gameweeksRecorded > 0
          ? total.seasonPoints / total.gameweeksRecorded
          : null,
      gameweeksRecorded: total?.gameweeksRecorded ?? 0,
      ownerTeamId: owner?.teamId ?? null,
      ownerName: owner?.managerName ?? null,
      clubName: clubs.get(player.realTeamId) ?? null,
    };
  });
}

export type CatalogueFilter = {
  query: string;
  position: string | null;
  ownership: "all" | "owned" | "free";
};

/**
 * Name and club, case-insensitively. The club name does not come from this endpoint —
 * it is joined in from the squad responses the sweep already fetches — so a player
 * whose club has never been observed is findable by name only.
 */
export function filterCatalogue(rows: CatalogueRow[], filter: CatalogueFilter): CatalogueRow[] {
  const query = filter.query.trim().toLowerCase();
  return rows.filter((row) => {
    if (query !== "") {
      const haystack = row.clubName === null ? row.nickname : `${row.nickname} ${row.clubName}`;
      if (!haystack.toLowerCase().includes(query)) return false;
    }
    if (filter.position !== null && row.position !== filter.position) return false;
    if (filter.ownership === "owned" && row.ownerTeamId === null) return false;
    if (filter.ownership === "free" && row.ownerTeamId !== null) return false;
    return true;
  });
}

/**
 * What a catalogue row's meta line leads with: the club when it is known, the position
 * when it is not.
 *
 * Ruling 4 gave the club the position's place because position is the only one of that
 * line's four facts reachable another way — the filter pills select it and the player's
 * own page prints it — while the owner and the availability status have no second
 * route. Ruling 5 hands the slot back when there is no club to show, so no row is ever
 * left opening on the owner, and the catalogue behaves exactly as it did before on the
 * day this deploys, improving on its own as sweeps observe clubs.
 *
 * The two categories are visually unmistakable, so a reader is never misled about
 * which one a given row is showing.
 */
export function clubOrPosition(row: Pick<CatalogueRow, "clubName" | "position">): string {
  return row.clubName ?? row.position;
}

export type SortKey = "value" | "points" | "average" | "perMillion" | "name";

/**
 * A single recorded gameweek is not an average — it is one score wearing an average's
 * clothes, and it was outranking six-gameweek seasons under "Best average" by October.
 * Below this many recorded gameweeks a player sinks in that one sort exactly like an
 * unknown value does, rather than being hidden or relabelled: they are still visible
 * (and still show their real average) under every other sort and in their own row.
 * Three is the smallest sample that resists a single outlier while staying reachable
 * in the season's first month, which is when this sort gets used the most.
 *
 * It governs two rankings now, which is why it is no longer named after one of them:
 * points per million has exactly the same weakness for exactly the same reason — a
 * cheap player with one lucky appearance — and answering it with a second, different
 * number would be two claims about one question, on data nobody has.
 */
export const MIN_GAMEWEEKS_FOR_RANKING = 3;

/**
 * Sorts a copy, never the caller's array.
 *
 * An unknown value sinks rather than sorting as zero: a player whose first snapshot
 * has not been taken is not the cheapest player in the league, and putting them there
 * is the same false-zero mistake the team-value chart already had to fix once.
 */
export function sortCatalogue(rows: CatalogueRow[], key: SortKey): CatalogueRow[] {
  const byName = (a: CatalogueRow, b: CatalogueRow) => a.nickname.localeCompare(b.nickname);

  const descending = (pick: (row: CatalogueRow) => number | null) => (a: CatalogueRow, b: CatalogueRow) => {
    const left = pick(a);
    const right = pick(b);
    if (left === null && right === null) return byName(a, b);
    if (left === null) return 1;
    if (right === null) return -1;
    return right - left || byName(a, b);
  };

  const comparators: Record<SortKey, (a: CatalogueRow, b: CatalogueRow) => number> = {
    value: descending((row) => row.currentValue),
    points: descending((row) => row.seasonPoints),
    average: descending((row) =>
      row.gameweeksRecorded >= MIN_GAMEWEEKS_FOR_RANKING ? row.averagePoints : null,
    ),
    perMillion: descending((row) =>
      row.gameweeksRecorded >= MIN_GAMEWEEKS_FOR_RANKING
        ? pointsPerMillion(row.seasonPoints, row.currentValue)
        : null,
    ),
    name: byName,
  };

  return [...rows].sort(comparators[key]);
}

/**
 * How many rows a home-page board shows.
 *
 * Five is a landing page's worth of rows rather than a measured figure, which is
 * exactly why it has a name. Neither `OpportunityBoard` nor the home page imports it —
 * `bestValueForMoney` and `freeAndScoring` receive it as their default parameter, which
 * is better than a component reaching for the constant itself: disagreeing with it
 * later costs one changed number, here, rather than a search for every place `5` might
 * be sitting.
 */
export const BOARD_ROWS = 5;

/**
 * The best points per million of market value.
 *
 * Unqualified rows are FILTERED, not sunk — the difference from `sortCatalogue`'s own
 * treatment, and the reason is the board's size. Five rows are a claim that these are
 * the best; a board padded to five with rows that cannot be ranked, showing a dash
 * where the figure goes, makes that claim falsely. See Ruling 4.
 *
 * Three things disqualify a player: fewer than `MIN_GAMEWEEKS_FOR_RANKING` recorded
 * gameweeks, no value snapshot yet (which is what `pointsPerMillion` returns null for,
 * alongside a value of zero), and a points-per-million figure that is not positive.
 * That last one is the same argument as the first, aimed at a different way a row can
 * fail to earn its place: season points can be negative in this game, so a player with
 * three recorded gameweeks and nought (or fewer) points would still pass the floor and
 * render as "0.0" or a negative figure under a heading that says "best" — one row
 * making the padded board's false claim instead of five. A board that runs three rows
 * long because the fourth and fifth would lie is the honest outcome its own empty
 * state already blesses.
 */
export function bestValueForMoney(rows: CatalogueRow[], limit = BOARD_ROWS): CatalogueRow[] {
  const qualified = rows.filter((row) => {
    if (row.gameweeksRecorded < MIN_GAMEWEEKS_FOR_RANKING) return false;
    const perMillion = pointsPerMillion(row.seasonPoints, row.currentValue);
    return perMillion !== null && perMillion > 0;
  });
  return sortCatalogue(qualified, "perMillion").slice(0, limit);
}

/**
 * Unowned players who are actually scoring, best first.
 *
 * Deliberately takes no `ownershipKnown`: this function cannot tell "nobody owns them"
 * from "no squad has been read", and it should not try. The caller renders Ruling 6's
 * line instead of calling this at all when ownership is unknown.
 *
 * A free player on nought points is excluded rather than padding the list. The block
 * is called "Free and scoring", and a scoreless row would make its own heading false.
 * No value is required — ownership and points are the whole claim here.
 */
export function freeAndScoring(rows: CatalogueRow[], limit = BOARD_ROWS): CatalogueRow[] {
  const free = filterCatalogue(rows, { query: "", position: null, ownership: "free" }).filter(
    (row) => row.seasonPoints > 0,
  );
  return sortCatalogue(free, "points").slice(0, limit);
}

/** Oldest first: the chart reads left to right, and the caller's order is not a series. */
export function valueSeries(values: ValuePoint[]): ValuePoint[] {
  return [...values].sort((a, b) => a.takenOn.localeCompare(b.takenOn));
}

/**
 * One entry per gameweek from the first to the last of the season.
 *
 * A gameweek with no row is `null`, not `0`: nothing was recorded, and nought points is
 * a different statement about a player's season.
 *
 * `seasonLastGameweek` is what keeps two players' charts comparable. Deriving the axis
 * from the player's own rows alone was wrong in a way only live data showed: LaLiga
 * plays some fixtures early, so on 2026-09-09 the 47 Celta and Real Sociedad players had
 * a gameweek 6 nobody else had — and gameweek 5 had not been played at all. They got a
 * six-wide chart with a hole in it while everyone else got a four-wide one, and two
 * charts on the same screen meant different things by the same width.
 *
 * The axis still stretches past the season figure when a player has a row beyond it,
 * because that early score is true and truncating the axis would discard it. The
 * argument is optional so a caller with no season figure keeps the old behaviour rather
 * than silently getting a one-week chart.
 */
export function pointsSeries(
  points: GameweekPoints[],
  seasonLastGameweek?: number,
): { gameweek: number; points: number | null }[] {
  if (points.length === 0) return [];
  const last = Math.max(...points.map((p) => p.gameweek), seasonLastGameweek ?? 0);
  const at = new Map(points.map((p) => [p.gameweek, p.points]));
  return Array.from({ length: last }, (_, i) => ({
    gameweek: i + 1,
    points: at.get(i + 1) ?? null,
  }));
}

/**
 * Points per million of market value.
 *
 * Nothing renders this yet, on purpose. "Opportunity" could mean players rising in
 * value, points per million, or unowned players scoring well; the slice builds what
 * all three need and none of the views, so the choice is made against a real catalogue
 * rather than guessed at now. This is the arithmetic half of one of them.
 */
export function pointsPerMillion(seasonPoints: number, currentValue: number | null): number | null {
  if (currentValue === null || currentValue === 0) return null;
  return seasonPoints / (currentValue / 1_000_000);
}

/**
 * Money, at the length a phone can read. Shared by both views, so it lives here.
 *
 * The million threshold is checked against the ROUNDED thousands figure, not the raw
 * value: `Math.round(999_999 / 1000)` is `1000`, so a value just under a million was
 * rendering as "1000K" — three hundred and fourteen of the 836 real players sit under
 * €1M, and three of those currently fall in the last €50K below the boundary.
 */
export function formatMoney(value: number): string {
  const roundedThousands = Math.round(value / 1000);
  if (Math.abs(value) >= 1_000_000 || Math.abs(roundedThousands) >= 1000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  return `${roundedThousands}K`;
}

/**
 * Task 1 established the five real `status` values. Translating them to proper
 * English is naming a known vocabulary, not inventing one; any value not in this map
 * (there is none today) falls back to the raw string rather than vanishing.
 * `ok` is deliberately absent — availability is only worth surfacing as a problem —
 * and returns `null` so callers render nothing. Shared by both the catalogue and the
 * player page, so it lives here rather than in either component.
 */
const STATUS_LABELS: Record<string, string> = {
  out_of_league: "Out of the league",
  injured: "Injured",
  doubtful: "Doubtful",
  suspended: "Suspended",
};

export function statusLabel(status: string): string | null {
  if (status === "ok") return null;
  return STATUS_LABELS[status] ?? status;
}

/**
 * Three states, not two. "Free agent" is a claim about the world — nobody owns this
 * player — and the database can only support that claim once at least one squad has
 * been read. Before that, an absent owner row means "we have not looked", not "nobody
 * owns them", and the two must never render the same way. Shared by the catalogue and
 * the player detail page so the two cannot drift into saying it differently.
 */
export type OwnerDisplay =
  | { kind: "owned"; name: string }
  | { kind: "free" }
  | { kind: "unknown" };

export function ownerDisplay(ownerName: string | null, ownershipKnown: boolean): OwnerDisplay {
  if (ownerName !== null) return { kind: "owned", name: ownerName };
  if (!ownershipKnown) return { kind: "unknown" };
  return { kind: "free" };
}

const SORT_KEYS: SortKey[] = ["value", "points", "average", "perMillion", "name"];
const OWNERSHIP_KEYS: CatalogueFilter["ownership"][] = ["all", "owned", "free"];

/**
 * The catalogue view a URL asks for.
 *
 * The address is an entry point, not a mirror: this reads the opening state and nothing
 * writes it back, so pressing pills afterwards does not rewrite the URL. Making it a
 * mirror means keeping router and component state in step inside a component that has
 * no such coupling today, which is more than the affordance is worth. See Ruling 8.
 *
 * Anything unrecognised — a typo, a stale link, a repeated parameter — falls back to the
 * view the catalogue opens with anyway. A bad link should degrade to the normal page.
 */
export function parseCatalogueEntry(params: Record<string, string | string[] | undefined>): {
  sort: SortKey;
  ownership: CatalogueFilter["ownership"];
} {
  const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : null);
  return {
    sort: SORT_KEYS.find((key) => key === one(params.sort)) ?? "value",
    ownership: OWNERSHIP_KEYS.find((key) => key === one(params.ownership)) ?? "all",
  };
}
