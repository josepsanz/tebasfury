export type Snapshot = {
  teamId: string;
  gameweek: number;
  points: number;
  roundPosition: number;
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
      const withValue = [...mine].reverse().find((s) => s.teamValue !== null) ?? null;
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
