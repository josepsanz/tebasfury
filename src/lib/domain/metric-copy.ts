import type { RoundRecord, Trend } from "./metrics";

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
  if (record === null) return { value: "No rounds yet" };
  return { value: String(record.points), note: `${nameOf(record.teamId)}, GW${record.gameweek}` };
}
