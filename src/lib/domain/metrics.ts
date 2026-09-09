import type { Snapshot } from "./standings";

export type Trend = { slope: number; rising: boolean } | null;
export type Streak = { rounds: number; above: boolean };
export type RoundRecord = { points: number; gameweek: number; teamId: string } | null;

export type TeamMetrics = {
  best: RoundRecord;
  worst: RoundRecord;
  average: number | null;
  trend: Trend;
  regularity: number | null;
  streak: Streak;
  pointsPerMillion: number | null;
  /** Settled rounds only (Ruling 8) — the same count `formatStreak` needs to tell
   *  "level with the league" apart from "never played". */
  roundsPlayed: number;
};

export type LeagueMetrics = {
  best: RoundRecord;
  worst: RoundRecord;
  average: number | null;
  trend: Trend;
};

/** One decimal, once, where the figure is computed. */
const round1 = (n: number) => Math.round(n * 10) / 10;

const byGameweek = (a: { gameweek: number }, b: { gameweek: number }) => a.gameweek - b.gameweek;

/**
 * A blank gameweek is a missing lineup, not a performance (Ruling 1), so the records
 * skip it. Ties go to the earliest gameweek: the first time it happened is the record.
 *
 * A tie WITHIN the same gameweek (two managers, one score) is broken by `teamId`, never
 * left to array order: `queries.ts` orders `team_gameweek_stats` by gameweek only, and
 * its own comment warns that Postgres's heap order shifts after an update or a vacuum.
 * `standings.ts` set the precedent — a stable secondary key so the order never wobbles
 * between renders — and this is the same fix for the same reason.
 */
function recordOf(rows: Snapshot[], pick: "max" | "min"): RoundRecord {
  const played = rows
    .filter((row) => row.points !== 0)
    .sort((a, b) => byGameweek(a, b) || a.teamId.localeCompare(b.teamId));
  if (played.length === 0) return null;

  const best = played.reduce((chosen, row) =>
    pick === "max"
      ? row.points > chosen.points
        ? row
        : chosen
      : row.points < chosen.points
        ? row
        : chosen,
  );
  return { points: best.points, gameweek: best.gameweek, teamId: best.teamId };
}

const mean = (values: number[]) =>
  values.length === 0 ? null : round1(values.reduce((a, b) => a + b, 0) / values.length);

/**
 * Least squares over the last three readings, in points per gameweek.
 *
 * Three is deliberately few (Ruling 2): the alternative that survives a single bad week
 * needs six gameweeks and would say nothing until October. A slope of exactly zero is
 * not rising — a flat run is flat.
 */
function trendOf(series: { gameweek: number; value: number }[]): Trend {
  const last = [...series].sort(byGameweek).slice(-3);
  if (last.length < 3) return null;

  const meanX = last.reduce((a, p) => a + p.gameweek, 0) / last.length;
  const meanY = last.reduce((a, p) => a + p.value, 0) / last.length;
  const top = last.reduce((a, p) => a + (p.gameweek - meanX) * (p.value - meanY), 0);
  const bottom = last.reduce((a, p) => a + (p.gameweek - meanX) ** 2, 0);
  if (bottom === 0) return null;

  const slope = round1(top / bottom);
  return { slope, rising: slope > 0 };
}

/** Population standard deviation, in points. Needs two rounds to mean anything. */
function spreadOf(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  return round1(Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / values.length));
}

/** The league's mean score for each gameweek, which is what a streak is measured against. */
function averageByGameweek(rows: Snapshot[]): Map<number, number> {
  const totals = new Map<number, { sum: number; count: number }>();
  for (const row of rows) {
    const at = totals.get(row.gameweek) ?? { sum: 0, count: 0 };
    totals.set(row.gameweek, { sum: at.sum + row.points, count: at.count + 1 });
  }
  return new Map([...totals].map(([week, { sum, count }]) => [week, sum / count]));
}

/**
 * How many rounds in a row, counting back from the latest, a team has been on one side
 * of the league. Measured against the league rather than against position (Ruling 3):
 * a position moves when other people score, and this is meant to be about the manager.
 */
function streakOf(rows: Snapshot[], teamId: string, leagueAverage: Map<number, number>): Streak {
  const mine = rows.filter((row) => row.teamId === teamId).sort(byGameweek).reverse();
  if (mine.length === 0) return { rounds: 0, above: false };

  const first = mine[0];
  const firstAverage = leagueAverage.get(first.gameweek) ?? 0;
  if (first.points === firstAverage) return { rounds: 0, above: false };

  const above = first.points > firstAverage;
  let rounds = 0;
  for (const row of mine) {
    const average = leagueAverage.get(row.gameweek) ?? 0;
    if (row.points === average) break;
    if (row.points > average !== above) break;
    rounds += 1;
  }
  return { rounds, above };
}

/**
 * Every metric describes rounds that have FINISHED (Ruling 8), so both entry points
 * filter provisional rows here, before anything downstream sees them: the records, the
 * average, the trend, the spread, and the array handed to `streakOf` — including the
 * league averages it measures against.
 *
 * The filter is safe. `upsertStats` (`lib/sync/index.ts`) writes `isProvisional: live`
 * for the week currently being played and rewrites that same row to `false` once it
 * settles — so a settled week is never missing here, only ever delayed by the two or
 * three days its round is open.
 */
function settledOnly(snapshots: Snapshot[]): Snapshot[] {
  return snapshots.filter((row) => !row.isProvisional);
}

export function teamMetrics(snapshots: Snapshot[], teamId: string): TeamMetrics {
  const settled = settledOnly(snapshots);
  const mine = settled.filter((row) => row.teamId === teamId);
  const points = mine.map((row) => row.points);

  const values = mine
    .slice()
    .sort(byGameweek)
    .filter((row) => row.teamValue !== null);
  const latestValue = values.at(-1)?.teamValue ?? null;
  const total = points.reduce((a, b) => a + b, 0);

  return {
    best: recordOf(mine, "max"),
    worst: recordOf(mine, "min"),
    average: mean(points),
    trend: trendOf(mine.map((row) => ({ gameweek: row.gameweek, value: row.points }))),
    regularity: spreadOf(points),
    streak: streakOf(settled, teamId, averageByGameweek(settled)),
    pointsPerMillion:
      latestValue === null || latestValue === 0 ? null : round1(total / (latestValue / 1_000_000)),
    roundsPlayed: mine.length,
  };
}

export function leagueMetrics(snapshots: Snapshot[]): LeagueMetrics {
  const settled = settledOnly(snapshots);
  const averages = averageByGameweek(settled);

  return {
    best: recordOf(settled, "max"),
    worst: recordOf(settled, "min"),
    average: mean(settled.map((row) => row.points)),
    trend: trendOf([...averages].map(([gameweek, value]) => ({ gameweek, value }))),
  };
}
