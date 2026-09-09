export type Snapshot = {
  teamId: string;
  gameweek: number;
  points: number;
  /** Null for a week observed live: that response reports no rank within the round. */
  roundPosition: number | null;
  livePoints: number | null;
  isProvisional: boolean;
  teamValue: number | null;
};

export type TeamRef = { id: string; managerName: string };

export type TableRow = {
  teamId: string;
  managerName: string;
  position: number;
  previousPosition: number | null;
  cumulativePoints: number;
  livePoints: number | null;
  teamValue: number | null;
  isProvisional: boolean;
};

export type Point = { teamId: string; gameweek: number; value: number | null };

export type Series = {
  pointsPerWeek: Point[];
  cumulativePoints: Point[];
  tablePosition: Point[];
  teamValue: Point[];
};

const weeksIn = (snapshots: Snapshot[]): number[] =>
  [...new Set(snapshots.map((s) => s.gameweek))].sort((a, b) => a - b);

/**
 * Ranks teams by cumulative points up to and including `upTo`.
 *
 * This is the whole reason the module exists: the API's `position` inside a
 * gameweek is the rank WITHIN that round, so the table has to be recomputed from
 * the totals. Ties break on manager name, so the order never wobbles between
 * renders.
 */
function rankAt(snapshots: Snapshot[], teams: TeamRef[], upTo: number): Map<string, number> {
  const totals = new Map(teams.map((t) => [t.id, 0]));
  for (const s of snapshots) {
    if (s.gameweek <= upTo) totals.set(s.teamId, (totals.get(s.teamId) ?? 0) + s.points);
  }
  const names = new Map(teams.map((t) => [t.id, t.managerName]));
  const ordered = [...totals.entries()].sort(
    (a, b) => b[1] - a[1] || (names.get(a[0]) ?? "").localeCompare(names.get(b[0]) ?? ""),
  );
  return new Map(ordered.map(([teamId], i) => [teamId, i + 1]));
}

export function buildTable(snapshots: Snapshot[], teams: TeamRef[]): TableRow[] {
  const weeks = weeksIn(snapshots);
  const latest = weeks.at(-1) ?? 0;
  const previous = weeks.length > 1 ? weeks[weeks.length - 2] : null;

  const current = rankAt(snapshots, teams, latest);
  const before = previous === null ? null : rankAt(snapshots, teams, previous);

  return teams
    .map((team): TableRow => {
      const mine = snapshots.filter((s) => s.teamId === team.id);
      const latestSnapshot = mine.find((s) => s.gameweek === latest) ?? null;
      // The latest week that has a value, chosen by gameweek rather than by position
      // in the array: this is a pure function and must not depend on the order its
      // caller happened to read the rows in.
      const withValue = mine.reduce<Snapshot | null>(
        (best, s) =>
          s.teamValue !== null && (best === null || s.gameweek > best.gameweek) ? s : best,
        null,
      );
      return {
        teamId: team.id,
        managerName: team.managerName,
        position: current.get(team.id) ?? teams.length,
        previousPosition: before?.get(team.id) ?? null,
        cumulativePoints: mine.reduce((sum, s) => sum + s.points, 0),
        livePoints: latestSnapshot?.livePoints ?? null,
        teamValue: withValue?.teamValue ?? null,
        isProvisional: latestSnapshot?.isProvisional ?? false,
      };
    })
    .sort((a, b) => a.position - b.position);
}

export function buildSeries(snapshots: Snapshot[], teams: TeamRef[]): Series {
  const weeks = weeksIn(snapshots);
  const at = new Map(snapshots.map((s) => [`${s.teamId}:${s.gameweek}`, s]));

  const pointsPerWeek: Point[] = [];
  const cumulativePoints: Point[] = [];
  const tablePosition: Point[] = [];
  const teamValue: Point[] = [];

  const running = new Map(teams.map((t) => [t.id, 0]));
  for (const gameweek of weeks) {
    const ranks = rankAt(snapshots, teams, gameweek);
    for (const team of teams) {
      const s = at.get(`${team.id}:${gameweek}`);
      running.set(team.id, (running.get(team.id) ?? 0) + (s?.points ?? 0));
      pointsPerWeek.push({ teamId: team.id, gameweek, value: s?.points ?? null });
      cumulativePoints.push({ teamId: team.id, gameweek, value: running.get(team.id) ?? 0 });
      tablePosition.push({ teamId: team.id, gameweek, value: ranks.get(team.id) ?? null });
      teamValue.push({ teamId: team.id, gameweek, value: s?.teamValue ?? null });
    }
  }

  return { pointsPerWeek, cumulativePoints, tablePosition, teamValue };
}

export type RoundRow = {
  teamId: string;
  managerName: string;
  position: number;
  points: number;
  /** True when we worked the place out ourselves, which only happens for a live round. */
  positionDerived: boolean;
};

/**
 * One round's table: what each manager scored that week, ranked within it.
 *
 * **The place comes from the API wherever the API gave one.** This was measured rather
 * than assumed, and the measurement inverted the obvious design. Across all 52 rows in
 * production on 2026-09-09, a rank derived from the round's points disagreed with the
 * stored `roundPosition` seven times — and every disagreement was a tie. Where two teams
 * score the same, a derived rank shares a place and skips the next; the API hands out
 * DISTINCT sequential places by a tie-break it does not publish. Three of the four rounds
 * played contained a tie, so deriving would have contradicted the app the league already
 * compares against, most weeks.
 *
 * The one exception is a round observed live, where `roundPosition` is null because the
 * response reports the overall table position instead. Only there do we rank, and there
 * tied teams SHARE a place — two on 1st and nobody 2nd — because we do not have the
 * API's tie-break and will not invent one. `positionDerived` lets the view say so.
 *
 * A team with no row for the round is absent rather than shown on nought: it did not
 * score nothing, we have nothing for it, which is the same distinction `pointsSeries`
 * makes with its gaps.
 */
export function buildRoundTable(
  snapshots: Snapshot[],
  teams: TeamRef[],
  gameweek: number,
): RoundRow[] {
  const names = new Map(teams.map((t) => [t.id, t.managerName]));
  const inRound = snapshots.filter((s) => s.gameweek === gameweek && names.has(s.teamId));
  if (inRound.length === 0) return [];

  // Sorted before any place is worked out, so the result cannot inherit the order the
  // caller's query happened to return. Ties break on manager name for a stable order —
  // which orders the ROWS, and is not the same as claiming one team beat the other.
  const ordered = [...inRound].sort(
    (a, b) =>
      b.points - a.points ||
      (names.get(a.teamId) ?? "").localeCompare(names.get(b.teamId) ?? ""),
  );

  const rows = ordered.map((s): RoundRow => {
    // Standard competition ranking: equal points share the earliest place, and the next
    // distinct score takes the place its index implies (1, 1, 3).
    const tiedWithEarlier = ordered.findIndex((o) => o.points === s.points);
    return {
      teamId: s.teamId,
      managerName: names.get(s.teamId) ?? "",
      position: s.roundPosition ?? tiedWithEarlier + 1,
      points: s.points,
      positionDerived: s.roundPosition === null,
    };
  });

  // By the place actually shown, so a stored set that disagrees with our points order —
  // which is exactly what a tie-break we do not know looks like — still reads top-down.
  return rows.sort((a, b) => a.position - b.position || a.managerName.localeCompare(b.managerName));
}
