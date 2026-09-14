import { describe, expect, it } from "vitest";
import {
  decideNextRun,
  isRedundantSweep,
  nextRunAfterFailure,
  nextPlayerSweep,
  nextPlayerSweepAfterFailure,
  FAILURE_INTERVAL_MS,
  LIVE_INTERVAL_MS,
  MAX_INTERVAL_MS,
  PLAYER_SWEEP_INTERVAL_MS,
  SWEEP_COLLAPSE_WINDOW_MS,
  SYNC_COLLAPSE_WINDOW_MS,
  STANDINGS_OVERDUE_LIVE_MS,
  STANDINGS_OVERDUE_IDLE_MS,
  SWEEP_OVERDUE_MS,
  overdueChains,
} from "./next-run";

const week = (over: Partial<Parameters<typeof decideNextRun>[0]> = {}) => ({
  number: 4,
  isLive: false,
  opensAt: new Date("2026-09-11T19:00:00Z"),
  closesAt: new Date("2026-09-15T01:00:00Z"),
  ...over,
});

const now = new Date("2026-09-08T12:00:00Z");

describe("decideNextRun", () => {
  it("comes back in ten minutes while the gameweek is live", () => {
    const next = decideNextRun(week({ isLive: true }), now);
    expect(next.getTime() - now.getTime()).toBe(LIVE_INTERVAL_MS);
  });

  it("waits for the next gameweek to open when nothing is live", () => {
    const soon = week({ opensAt: new Date("2026-09-09T07:00:00Z") });
    const next = decideNextRun(soon, now);
    expect(next.toISOString()).toBe("2026-09-09T07:00:00.000Z");
  });

  it("never waits longer than the heartbeat, so a missed schedule cannot strand the chain", () => {
    const faraway = week({ opensAt: new Date("2026-12-01T19:00:00Z") });
    const next = decideNextRun(faraway, now);
    expect(next.getTime() - now.getTime()).toBe(MAX_INTERVAL_MS);
  });

  it("falls back to the live interval when the opening date is already past", () => {
    const stale = week({ opensAt: new Date("2026-09-01T19:00:00Z") });
    const next = decideNextRun(stale, now);
    expect(next.getTime() - now.getTime()).toBe(LIVE_INTERVAL_MS);
  });
});

describe("nextRunAfterFailure", () => {
  it("still books a successor, sooner than a healthy idle run would", () => {
    const next = nextRunAfterFailure(now);
    expect(next.getTime() - now.getTime()).toBe(FAILURE_INTERVAL_MS);
    expect(FAILURE_INTERVAL_MS).toBeLessThan(LIVE_INTERVAL_MS);
  });
});

describe("the player sweep cadence", () => {
  const playerNow = new Date("2026-09-07T04:00:00Z");

  it("comes back six hours later", () => {
    expect(nextPlayerSweep(playerNow).toISOString()).toBe("2026-09-07T10:00:00.000Z");
  });

  it("comes back sooner after a failure, but not fast enough to hammer", () => {
    expect(nextPlayerSweepAfterFailure(playerNow).toISOString()).toBe(
      "2026-09-07T05:00:00.000Z",
    );
  });
});

describe("isRedundantSweep", () => {
  const sweepNow = new Date("2026-09-08T16:00:00Z");
  const hoursBefore = (h: number) => new Date(sweepNow.getTime() - h * 60 * 60 * 1000);

  it("runs when nothing has ever swept, so a first sweep is never suppressed", () => {
    expect(isRedundantSweep(null, sweepNow)).toBe(false);
  });

  it("suppresses a sweep soon after another chain already swept", () => {
    expect(isRedundantSweep(hoursBefore(2), sweepNow)).toBe(true);
  });

  it("lets the surviving chain's own run through", () => {
    // The property the whole pairing exists for: a chain booking itself at exactly the
    // cadence must never land inside its own suppression window.
    const lastTime = new Date(sweepNow.getTime() - PLAYER_SWEEP_INTERVAL_MS);
    expect(isRedundantSweep(lastTime, sweepNow)).toBe(false);
  });

  it("keeps the window a clear fraction inside the cadence, whatever the cadence is", () => {
    // Stated as a RATIO rather than a number of hours: the two constants moved together
    // from 24h/20h to 6h/5h, and an absolute assertion would have passed the change while
    // failing to protect the property. A window at or above the cadence would make every
    // sweep suppress its own successor and stop the chain with no error anywhere.
    expect(SWEEP_COLLAPSE_WINDOW_MS).toBeLessThan(PLAYER_SWEEP_INTERVAL_MS);
    const margin = PLAYER_SWEEP_INTERVAL_MS - SWEEP_COLLAPSE_WINDOW_MS;
    expect(margin / PLAYER_SWEEP_INTERVAL_MS).toBeGreaterThanOrEqual(0.15);
  });

  it("runs again once the window has passed exactly", () => {
    const edge = new Date(sweepNow.getTime() - SWEEP_COLLAPSE_WINDOW_MS);
    expect(isRedundantSweep(edge, sweepNow)).toBe(false);
  });

  it("suppresses one millisecond inside the window", () => {
    const inside = new Date(sweepNow.getTime() - SWEEP_COLLAPSE_WINDOW_MS + 1);
    expect(isRedundantSweep(inside, sweepNow)).toBe(true);
  });

  it("runs when the clock says the last sweep is in the future, rather than locking out", () => {
    const skewed = new Date(sweepNow.getTime() + 60 * 60 * 1000);
    expect(isRedundantSweep(skewed, sweepNow)).toBe(false);
  });
});

describe("SYNC_COLLAPSE_WINDOW_MS", () => {
  it("stays a clear fraction inside the shortest interval the standings chain books", () => {
    // A ratio rather than a number of minutes, for the reason the sweep's twin test
    // states: an absolute assertion passes a cadence change while failing to protect the
    // property. Five minutes after a failure is shorter than ten while live, so it is the
    // one the window has to clear — at or above it, every run would suppress its own
    // successor and the chain would stop with no error anywhere.
    expect(SYNC_COLLAPSE_WINDOW_MS).toBeLessThan(FAILURE_INTERVAL_MS);
    const margin = FAILURE_INTERVAL_MS - SYNC_COLLAPSE_WINDOW_MS;
    expect(margin / FAILURE_INTERVAL_MS).toBeGreaterThanOrEqual(0.15);
  });
});

describe("overdueChains", () => {
  const now = new Date("2026-09-14T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const healthy = {
    standingsLastRunAt: ago(5 * 60 * 1000),
    sweepLastRunAt: ago(2 * 60 * 60 * 1000),
    isLive: true,
    now,
  };

  it("revives nothing while both chains are running to cadence", () => {
    expect(overdueChains(healthy)).toEqual({ standings: false, players: false });
  });

  it("calls the standings chain dead when a live gameweek has gone quiet", () => {
    // The failure this exists for: on 2026-09-14 a booking was rejected, the chain ended
    // mid-gameweek, and nothing noticed until a person did. Ten minutes is the cadence;
    // anything past two and a half of them, while a week is being played, is not slow.
    expect(overdueChains({ ...healthy, standingsLastRunAt: ago(STANDINGS_OVERDUE_LIVE_MS) }))
      .toMatchObject({ standings: true });
  });

  it("gives an idle chain the whole heartbeat before judging it", () => {
    // Between gameweeks the chain sleeps on purpose, capped at 24 hours. Waking it every
    // half hour because it is quiet would replace the design with a cron.
    const idle = { ...healthy, isLive: false, standingsLastRunAt: ago(20 * 60 * 60 * 1000) };
    expect(overdueChains(idle)).toMatchObject({ standings: false });

    expect(overdueChains({ ...idle, standingsLastRunAt: ago(STANDINGS_OVERDUE_IDLE_MS) }))
      .toMatchObject({ standings: true });
  });

  it("does not mistake an idle week for a live one", () => {
    // A quiet 40 minutes is death during a live week and nothing at all outside one.
    const quiet = ago(40 * 60 * 1000);
    expect(overdueChains({ ...healthy, standingsLastRunAt: quiet })).toMatchObject({ standings: true });
    expect(overdueChains({ ...healthy, standingsLastRunAt: quiet, isLive: false })).toMatchObject({
      standings: false,
    });
  });

  it("calls the sweep dead an hour past its six", () => {
    expect(overdueChains({ ...healthy, sweepLastRunAt: ago(SWEEP_OVERDUE_MS) })).toMatchObject({
      players: true,
    });
  });

  it("revives a chain that has never run at all", () => {
    expect(overdueChains({ ...healthy, standingsLastRunAt: null, sweepLastRunAt: null })).toEqual({
      standings: true,
      players: true,
    });
  });

  it("leaves a chain alone when the clock says it ran in the future", () => {
    // Same refusal `withinWindow` makes: a clock this code cannot reason about is not a
    // reason to start a second chain.
    const skewed = new Date(now.getTime() + 60 * 60 * 1000);
    expect(overdueChains({ ...healthy, standingsLastRunAt: skewed, sweepLastRunAt: skewed })).toEqual({
      standings: false,
      players: false,
    });
  });

  it("keeps every threshold clear of the cadence it is watching", () => {
    // Ratios, not numbers: a threshold at or under the cadence would call a healthy chain
    // dead and start a second one on top of it every time the watchdog fired.
    expect(STANDINGS_OVERDUE_LIVE_MS).toBeGreaterThan(2 * LIVE_INTERVAL_MS);
    expect(STANDINGS_OVERDUE_IDLE_MS).toBeGreaterThan(MAX_INTERVAL_MS);
    expect(SWEEP_OVERDUE_MS).toBeGreaterThan(PLAYER_SWEEP_INTERVAL_MS);
  });
});
