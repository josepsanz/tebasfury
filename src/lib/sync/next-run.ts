import { leagueDate, leagueWallTime } from "@/lib/domain/clock";
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

export const PLAYER_FAILURE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * When the sweep runs: four fixed slots a day, in Spain's time.
 *
 * It was a flat six hours until 2026-10-03, and a flat interval drifts: its hour depends on
 * when the chain first fired, so it never reliably read the market just after the daily
 * auction turns over. The owner's requirement is a read no earlier than 19:30 Madrid time;
 * 19:45 keeps a quarter of an hour of margin, and the other three slots keep the same four
 * sweeps a day the flat interval made.
 */
export const PLAYER_SWEEP_SLOTS = [
  { hour: 1, minute: 45 },
  { hour: 7, minute: 45 },
  { hour: 13, minute: 45 },
  { hour: 19, minute: 45 },
] as const;

/** The distance between two slots on an ordinary day. */
export const PLAYER_SWEEP_SPACING_MS = 6 * 60 * 60 * 1000;

/**
 * The closest a booking may land to the run that makes it.
 *
 * **This is what keeps the grid from killing the chain.** `claimPlayerSweep` stands down any
 * firing within `SWEEP_COLLAPSE_WINDOW_MS` of another sweep's start. A grid slot can be minutes
 * away (a retry that succeeds just before one), and booking it would end the only chain
 * there is. So a slot nearer than this is skipped for the next. It must stay above the
 * window and below the spacing; a test pins both.
 */
export const PLAYER_SWEEP_MIN_LEAD_MS = 5.5 * 60 * 60 * 1000;

/** The first grid slot at least `PLAYER_SWEEP_MIN_LEAD_MS` after `now`. */
export function nextPlayerSweep(now: Date): Date {
  const earliest = now.getTime() + PLAYER_SWEEP_MIN_LEAD_MS;
  const { year, month, day } = leagueDate(new Date(earliest));
  for (let offset = 0; offset <= 1; offset += 1) {
    for (const slot of PLAYER_SWEEP_SLOTS) {
      const at = leagueWallTime(year, month, day + offset, slot.hour, slot.minute);
      if (at.getTime() >= earliest) return at;
    }
  }
  // Unreachable: the last slot of the next day is always more than 5.5 h after `now`.
  throw new Error("No player sweep slot found");
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

/**
 * How recently another scheduled sweep must have STARTED for this one to stand down —
 * the window `claimPlayerSweep` tests.
 *
 * **This must stay under `PLAYER_SWEEP_MIN_LEAD_MS`, the closest a booking ever lands to
 * the run that made it, and moving one without the other is how the whole chain dies.**
 * A window equal to or longer than that lead would make a sweep suppress its own
 * successor, and the chain would stop with no error anywhere.
 *
 * Half an hour short of the lead: enough for QStash's delivery drift and the sweep's own
 * ten seconds without closing it.
 */
export const SWEEP_COLLAPSE_WINDOW_MS = 5 * 60 * 60 * 1000;

/**
 * How recently another standings run must have STARTED for this one to be redundant.
 *
 * Two minutes, and neither the number nor the shape of the rule is the sweep's. That
 * window is a fraction under a single cadence; this chain books two intervals — ten
 * minutes while a gameweek is live, five after a failed run — and the window has to clear
 * the SHORTER of them. At or above it, every run would suppress its own successor and the
 * chain would stop with no error anywhere, which is the one failure this whole file
 * exists to prevent. Two minutes is still enormous next to what it collapses: the fork
 * this window was measured against fired its twins 70 ms apart, and no twin pair since
 * has landed further apart than 1.7 s.
 *
 * A guard that READS and then writes cannot win this race: twins milliseconds apart each
 * spend a few hundred more fetching a token before writing anything, so both would read
 * an empty window and both would proceed. The sweep learned that the same way on
 * 2026-10-03, and now claims too (`claimPlayerSweep`). The guard is
 * `claimStandingsRun` instead — one statement that tests this window and writes the run's
 * row together, the same no-transactions reasoning as the team claim and the Necroporra's
 * vote upsert.
 */
export const SYNC_COLLAPSE_WINDOW_MS = 2 * 60 * 1000;

/**
 * How quiet a LIVE gameweek's standings chain may go before it is presumed dead.
 *
 * Two and a half cadences. While a week is being played the chain books itself every ten
 * minutes, so twenty-five is far outside anything healthy and still inside the window
 * where a reader would notice the table had stopped moving.
 */
export const STANDINGS_OVERDUE_LIVE_MS = 25 * 60 * 1000;

/**
 * The same question between gameweeks, where silence is the design rather than a symptom.
 *
 * An idle chain sleeps until the next week opens, capped at the 24-hour heartbeat, so the
 * threshold is that cap plus half an hour of delivery drift. Anything tighter would wake a
 * sleeping chain on schedule, which is a cron by another name and exactly what this
 * project decided not to have.
 */
export const STANDINGS_OVERDUE_IDLE_MS = MAX_INTERVAL_MS + 30 * 60 * 1000;

/**
 * How late past its booked slot the sweep may be before it is presumed dead.
 *
 * Not a constant gap since the last run: on the grid a healthy gap runs from 5.5 h to about
 * 12.5 h (a skipped slot, the spring night), so any single threshold either calls a healthy
 * chain dead or waits half a day to notice a dead one. The question is asked of the slot
 * the last run would have booked, plus an hour of delivery drift.
 */
export const SWEEP_GRACE_MS = 60 * 60 * 1000;

/**
 * Which chains have stopped and need starting again.
 *
 * The self-scheduling design has one hole, and on 2026-09-14 it opened: every run books
 * its successor, so a booking that is REJECTED ends the chain, and the 24-hour heartbeat
 * that would rediscover a lost schedule is itself a booked message. Nothing inside the
 * design can notice — the standings simply stop, mid-gameweek, until a person presses
 * "Sync now". This is what notices, from the outside.
 *
 * It answers "is this chain dead?", never "is it due?". A chain that is merely idle is
 * left alone: the thresholds sit a clear margin beyond the longest healthy gap, so a
 * watchdog firing every half hour finds nothing to do all season and costs one query.
 *
 * A run in the future is a clock this code cannot reason about, and reviving on a bad
 * clock would start a second chain beside a healthy one. So it does nothing.
 */
export type ChainRevival = { standings: boolean; players: boolean };

export function overdueChains({
  standingsLastRunAt,
  sweepLastRunAt,
  isLive,
  now,
}: {
  standingsLastRunAt: Date | null;
  sweepLastRunAt: Date | null;
  isLive: boolean;
  now: Date;
}): ChainRevival {
  const overdue = (lastRunAt: Date | null, threshold: number): boolean => {
    // Never run at all: a fresh database, or a chain nobody has started. Starting it is
    // the whole job.
    if (lastRunAt === null) return true;

    const elapsed = now.getTime() - lastRunAt.getTime();
    if (elapsed < 0) return false;

    return elapsed >= threshold;
  };

  return {
    standings: overdue(
      standingsLastRunAt,
      isLive ? STANDINGS_OVERDUE_LIVE_MS : STANDINGS_OVERDUE_IDLE_MS,
    ),
    players:
      sweepLastRunAt === null
        ? true
        : sweepLastRunAt.getTime() > now.getTime()
          ? false
          : now.getTime() >= nextPlayerSweep(sweepLastRunAt).getTime() + SWEEP_GRACE_MS,
  };
}
