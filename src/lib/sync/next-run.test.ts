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

  it("comes back a day later", () => {
    expect(nextPlayerSweep(playerNow).toISOString()).toBe("2026-09-08T04:00:00.000Z");
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

  it("suppresses a sweep hours after another chain already swept today", () => {
    expect(isRedundantSweep(hoursBefore(6), sweepNow)).toBe(true);
  });

  it("lets the surviving chain's own daily run through", () => {
    const yesterday = new Date(sweepNow.getTime() - PLAYER_SWEEP_INTERVAL_MS);
    expect(isRedundantSweep(yesterday, sweepNow)).toBe(false);
  });

  it("leaves hours of slack between the window and the daily cadence", () => {
    expect(SWEEP_COLLAPSE_WINDOW_MS).toBeLessThan(PLAYER_SWEEP_INTERVAL_MS);
    expect(PLAYER_SWEEP_INTERVAL_MS - SWEEP_COLLAPSE_WINDOW_MS).toBeGreaterThanOrEqual(
      4 * 60 * 60 * 1000,
    );
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
