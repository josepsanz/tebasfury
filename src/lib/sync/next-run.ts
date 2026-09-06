import type { CurrentWeek } from "@/lib/fantasy-client/schemas";

export const LIVE_INTERVAL_MS = 10 * 60 * 1000;
export const MAX_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Decides when the next sync should run, from data the run already fetched.
 *
 * While a gameweek is live the table moves, so we come back quickly. Otherwise we
 * wait for the next gameweek to open — but never longer than a week, so a schedule
 * lost by QStash or a deploy (or a long summer break between seasons) cannot strand
 * the chain forever.
 */
export function decideNextRun(week: CurrentWeek, now: Date): Date {
  if (week.isLive) return new Date(now.getTime() + LIVE_INTERVAL_MS);

  const opening = week.openingWeekDate.getTime();
  const delay = opening - now.getTime();

  if (delay <= 0) return new Date(now.getTime() + LIVE_INTERVAL_MS);
  return new Date(now.getTime() + Math.min(delay, MAX_INTERVAL_MS));
}
