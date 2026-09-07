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
  ownerTeamId: string | null;
  ownerName: string | null;
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
}): CatalogueRow[] {
  const totals = new Map(input.totals.map((t) => [t.playerId, t]));
  const values = new Map(input.values.map((v) => [v.playerId, v]));
  const owners = new Map(input.ownership.map((o) => [o.playerId, o]));

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
      ownerTeamId: owner?.teamId ?? null,
      ownerName: owner?.managerName ?? null,
    };
  });
}

export type CatalogueFilter = {
  query: string;
  position: string | null;
  ownership: "all" | "owned" | "free";
};

/**
 * Name only, case-insensitively. The API carries no club name to search against — see
 * Ruling 1 in this slice's spec — so the haystack is the nickname alone.
 */
export function filterCatalogue(rows: CatalogueRow[], filter: CatalogueFilter): CatalogueRow[] {
  const query = filter.query.trim().toLowerCase();
  return rows.filter((row) => {
    if (query !== "" && !row.nickname.toLowerCase().includes(query)) return false;
    if (filter.position !== null && row.position !== filter.position) return false;
    if (filter.ownership === "owned" && row.ownerTeamId === null) return false;
    if (filter.ownership === "free" && row.ownerTeamId !== null) return false;
    return true;
  });
}

export type SortKey = "value" | "points" | "average" | "name";

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
    average: descending((row) => row.averagePoints),
    name: byName,
  };

  return [...rows].sort(comparators[key]);
}

/** Oldest first: the chart reads left to right, and the caller's order is not a series. */
export function valueSeries(values: ValuePoint[]): ValuePoint[] {
  return [...values].sort((a, b) => a.takenOn.localeCompare(b.takenOn));
}

/**
 * One entry per gameweek from the first to the last recorded.
 *
 * A gameweek with no row is `null`, not `0`: nothing was recorded, and nought points is
 * a different statement about a player's season.
 */
export function pointsSeries(points: GameweekPoints[]): { gameweek: number; points: number | null }[] {
  if (points.length === 0) return [];
  const last = Math.max(...points.map((p) => p.gameweek));
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

/** Money, at the length a phone can read. Shared by both views, so it lives here. */
export function formatMoney(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  return `${Math.round(value / 1000)}K`;
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
