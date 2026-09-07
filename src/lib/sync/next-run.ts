import type { Gameweek } from "@/lib/fantasy-client";

export const LIVE_INTERVAL_MS = 10 * 60 * 1000;
export const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const FAILURE_INTERVAL_MS = 5 * 60 * 1000;

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
export function decideNextRun(week: Gameweek, now: Date): Date {
  if (week.isLive) return new Date(now.getTime() + LIVE_INTERVAL_MS);

  const opening = week.opensAt.getTime();
  const delay = opening - now.getTime();

  if (delay <= 0) return new Date(now.getTime() + LIVE_INTERVAL_MS);
  return new Date(now.getTime() + Math.min(delay, MAX_INTERVAL_MS));
}

/**
 * When to come back after a run that failed.
 *
 * A failed run learnt nothing about the calendar, so there is no gameweek to reason
 * from — but the chain is the only scheduler there is, and a run that books no
 * successor ends it. Sooner than an idle healthy run, because nothing is syncing
 * until one of these works; not so soon that a persistent outage is hammered.
 */
export function nextRunAfterFailure(now: Date): Date {
  return new Date(now.getTime() + FAILURE_INTERVAL_MS);
}

export const PLAYER_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const PLAYER_FAILURE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * When the next player sweep should run.
 *
 * A flat day. Nothing in the response says when values move, the API is unofficial and
 * undocumented, and the consensus among the projects using it is one full sweep a day.
 * There is no live window to chase: this is the slow half of the design, and the
 * ten-minute standings chain is unaffected by it.
 */
export function nextPlayerSweep(now: Date): Date {
  return new Date(now.getTime() + PLAYER_SWEEP_INTERVAL_MS);
}

/**
 * When to come back after a sweep that failed.
 *
 * An hour, not the standings chain's five minutes: a failed sweep costs the portal a
 * day of value resolution at worst, and hammering an undocumented API is exactly what
 * the daily cadence exists to avoid. Still far sooner than a day, because a sweep that
 * books no successor ends the chain.
 */
export function nextPlayerSweepAfterFailure(now: Date): Date {
  return new Date(now.getTime() + PLAYER_FAILURE_INTERVAL_MS);
}
