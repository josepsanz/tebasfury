import type { RoundRecord, Trend } from "./metrics";

/** The one wording for "nothing has been played yet" — shared so it is written once. */
const NO_ROUNDS_YET = "No rounds yet";

/**
 * A trend as a reader should see it: a direction, a size and a unit.
 *
 * The unit is the point. `▲ 6 pts/round` invites judgement about whether six is a lot;
 * a bare arrow asserts a conclusion the three readings behind it cannot support.
 */
export function formatTrend(trend: Trend): { value: string; tone?: "up" | "down" } {
  if (trend === null) return { value: "Needs another round" };
  if (trend.slope === 0) return { value: "Flat" };

  return trend.rising
    ? { value: `▲ ${trend.slope} pts/round`, tone: "up" }
    : { value: `▼ ${Math.abs(trend.slope)} pts/round`, tone: "down" };
}

/** A record, with whoever set it and when. */
export function formatRecord(
  record: RoundRecord,
  nameOf: (teamId: string) => string,
): { value: string; note?: string } {
  if (record === null) return { value: NO_ROUNDS_YET };
  return { value: String(record.points), note: `${nameOf(record.teamId)}, GW${record.gameweek}` };
}

/** A league or team average, or the same "nothing yet" wording every other figure uses. */
export function formatAverage(average: number | null): { value: string } {
  return { value: average === null ? NO_ROUNDS_YET : String(average) };
}

/**
 * The worst round, with the same caption a `formatRecord` for best round would carry,
 * plus the reason a blank gameweek can never be it: zeros are missing lineups, not
 * performances (Ruling 1), so the record-holder needs to know they were excluded.
 */
export function formatWorstRecord(
  record: RoundRecord,
  nameOf: (teamId: string) => string,
): { value: string; note?: string } {
  const base = formatRecord(record, nameOf);
  if (record === null) return base;
  return { ...base, note: `${base.note} · zeros excluded` };
}
