import type { CurrentWeek } from "@/lib/fantasy-client/schemas";

export const LIVE_INTERVAL_MS = 10 * 60 * 1000;
export const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Decides when the next sync should run, from data the run already fetched.
 *
 * While a gameweek is live the table moves, so we come back quickly. Otherwise we
 * wait for the next gameweek to open — but never longer than a day. This cap is the
 * only watchdog in the whole design: the chain is entirely self-scheduling, so it is
 * what recovers a schedule lost by QStash or a deploy. A live window runs about 78
 * hours (Friday evening to Monday night); a 24-hour cap guarantees a lost schedule
 * is rediscovered well inside that window, while the run is still live, so the one
 * and only live `teamValue`/`teamPoints` reading for that week is not lost to a
 * silent skip straight to a settled backfill.
 */
export function decideNextRun(week: CurrentWeek, now: Date): Date {
  if (week.isLive) return new Date(now.getTime() + LIVE_INTERVAL_MS);

  const opening = week.openingWeekDate.getTime();
  const delay = opening - now.getTime();

  if (delay <= 0) return new Date(now.getTime() + LIVE_INTERVAL_MS);
  return new Date(now.getTime() + Math.min(delay, MAX_INTERVAL_MS));
}
