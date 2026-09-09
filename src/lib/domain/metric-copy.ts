import type { RoundRecord, Streak, Trend } from "./metrics";
import { formatMoney } from "./players";

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

/**
 * A record, with the round it was set in — and, where the caller supplies one, whoever
 * set it. `nameOf` is optional so a page whose header already names its one subject (the
 * team page) is not made to repeat it in every tile's caption; the home page, where the
 * name IS the information, still passes one.
 */
export function formatRecord(
  record: RoundRecord,
  nameOf?: (teamId: string) => string,
): { value: string; note?: string } {
  if (record === null) return { value: NO_ROUNDS_YET };
  const note = nameOf ? `${nameOf(record.teamId)}, GW${record.gameweek}` : `GW${record.gameweek}`;
  return { value: String(record.points), note };
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
  nameOf?: (teamId: string) => string,
): { value: string; note?: string } {
  const base = formatRecord(record, nameOf);
  if (record === null) return base;
  return { ...base, note: `${base.note} · zeros excluded` };
}

/** How steady a team's scoring is, with a reminder that a smaller figure is steadier. */
export function formatRegularity(regularity: number | null): { value: string; note?: string } {
  if (regularity === null) return { value: "Needs two rounds" };
  return { value: `± ${regularity} pts`, note: "Lower is steadier" };
}

/** Points squeezed from squad value, or the same "nothing yet" wording as elsewhere. */
export function formatPointsPerMillion(pointsPerMillion: number | null): { value: string } {
  return { value: pointsPerMillion === null ? "No squad value recorded" : String(pointsPerMillion) };
}

/**
 * A run of rounds on one side of the league average — but only once there is a run to
 * report. `streakOf` cannot tell "level with the league" apart from "never played" on
 * its own (both are a zero-length streak), so this takes the rounds played as well and
 * resolves the ambiguity here, alongside the rest of the module's wording.
 */
export function formatStreak(
  streak: Streak,
  roundsPlayed: number,
): { value: string; tone?: "up" | "down" } {
  if (roundsPlayed === 0) return { value: NO_ROUNDS_YET };
  if (streak.rounds === 0) return { value: "Level with the league" };

  return {
    value: `${streak.rounds} ${streak.rounds === 1 ? "round" : "rounds"} ${streak.above ? "above" : "below"}`,
    tone: streak.above ? "up" : "down",
  };
}

/** How many rounds a team has played, correctly pluralised — "1 round", not "1 rounds". */
export function formatRoundsPlayed(rounds: number): string {
  return `${rounds} ${rounds === 1 ? "round" : "rounds"}`;
}


/**
 * Which way a player's market value is going, in money per day.
 *
 * The unit is the point, exactly as it is for a points trend: "▲ 480K/day" invites a
 * judgement about whether that is a lot, while a bare arrow asserts a conclusion three
 * readings cannot support.
 *
 * Fewer than three readings returns its own reason rather than a dash or a zero — a
 * player swept twice has no direction yet, which is a different statement from flat.
 */
export function formatValueTrend(trend: Trend): { value: string; tone?: "up" | "down" } {
  if (trend === null) return { value: "Needs another day" };
  if (trend.slope === 0) return { value: "Flat" };

  return trend.rising
    ? { value: `▲ ${formatMoney(trend.slope)}/day`, tone: "up" }
    : { value: `▼ ${formatMoney(Math.abs(trend.slope))}/day`, tone: "down" };
}
