import { describe, expect, it } from "vitest";
import {
  decideNextRun,
  nextRunAfterFailure,
  nextPlayerSweep,
  nextPlayerSweepAfterFailure,
  FAILURE_INTERVAL_MS,
  LIVE_INTERVAL_MS,
  MAX_INTERVAL_MS,
  PLAYER_SWEEP_MIN_LEAD_MS,
  PLAYER_SWEEP_SLOTS,
  PLAYER_SWEEP_SPACING_MS,
  SWEEP_COLLAPSE_WINDOW_MS,
  SYNC_COLLAPSE_WINDOW_MS,
  STANDINGS_OVERDUE_LIVE_MS,
  STANDINGS_OVERDUE_IDLE_MS,
  SWEEP_GRACE_MS,
  overdueChains,
} from "./next-run";
import { leagueWallTime } from "@/lib/domain/clock";

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
  const at = (iso: string) => nextPlayerSweep(new Date(iso)).toISOString();

  it("books the first slot of the Madrid grid at least five and a half hours out", () => {
    // 06:00 CEST: 07:45 is too close, so 13:45 CEST.
    expect(at("2026-09-07T04:00:00Z")).toBe("2026-09-07T11:45:00.000Z");
    // 13:45 CEST books 19:45 CEST, which is the read the market needs.
    expect(at("2026-10-03T11:45:00Z")).toBe("2026-10-03T17:45:00.000Z");
    // 19:45 CEST books 01:45 CEST the next day.
    expect(at("2026-10-03T17:45:00Z")).toBe("2026-10-03T23:45:00.000Z");
  });

  it("tolerates a late delivery without skipping the slot", () => {
    // QStash five minutes late: 01:45 is still 5 h 55 min away.
    expect(at("2026-10-03T17:50:00Z")).toBe("2026-10-03T23:45:00.000Z");
  });

  it("skips a slot a retry has come too close to, rather than landing inside the window", () => {
    // Failed at 19:45, succeeded on the hourly retry at 20:45 CEST. 01:45 is only five
    // hours away and would sit inside the collapse window, so it books 07:45 instead.
    expect(at("2026-10-03T18:45:00Z")).toBe("2026-10-04T05:45:00.000Z");
  });

  it("follows the clocks back in autumn", () => {
    // 01:45 CEST on 25 Oct; at 03:00 CEST the clocks go back to 02:00 CET.
    expect(at("2026-10-24T23:45:00Z")).toBe("2026-10-25T06:45:00.000Z");
  });

  it("skips one slot on the spring night rather than book a five-hour gap", () => {
    // 01:45 CET on 28 Mar 2027; 07:45 CEST is only five real hours later.
    expect(at("2027-03-28T00:45:00Z")).toBe("2027-03-28T11:45:00.000Z");
  });

  it("comes back sooner after a failure, but not fast enough to hammer", () => {
    expect(nextPlayerSweepAfterFailure(new Date("2026-09-07T04:00:00Z")).toISOString()).toBe(
      "2026-09-07T05:00:00.000Z",
    );
  });

  it("never books its own successor inside the collapse window, across both clock changes", () => {
    // The property the whole design rests on. A run's success row is written up to five
    // minutes after the `now` the booking was computed from, so that is the worst case.
    const ranges: [string, string][] = [
      ["2026-10-20T00:00:00Z", "2026-10-29T00:00:00Z"],
      ["2027-03-24T00:00:00Z", "2027-04-02T00:00:00Z"],
    ];
    const slots = new Set(PLAYER_SWEEP_SLOTS.map((s) => s.hour * 60 + s.minute));
    for (const [from, to] of ranges) {
      for (let t = Date.parse(from); t < Date.parse(to); t += 13 * 60 * 1000) {
        const now = new Date(t);
        const next = nextPlayerSweep(now);
        const lead = next.getTime() - t;
        expect(lead).toBeGreaterThanOrEqual(PLAYER_SWEEP_MIN_LEAD_MS);
        expect(lead).toBeLessThanOrEqual(PLAYER_SWEEP_MIN_LEAD_MS + PLAYER_SWEEP_SPACING_MS + 60 * 60 * 1000);
        // `claimPlayerSweep` measures its window from the booking run's START, which is
        // `now` here: the successor must land outside it, or the chain claims nothing.
        expect(lead).toBeGreaterThan(SWEEP_COLLAPSE_WINDOW_MS);
        const wall = new Intl.DateTimeFormat("en-GB", {
          timeZone: "Europe/Madrid",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).format(next);
        const [h, m] = wall.split(":").map(Number);
        expect(slots.has(h * 60 + m)).toBe(true);
      }
    }
  });

  it("keeps the window, the minimum lead and the grid spacing in that order", () => {
    // Moving one without the others is how the chain dies with no error anywhere.
    expect(SWEEP_COLLAPSE_WINDOW_MS).toBeLessThan(PLAYER_SWEEP_MIN_LEAD_MS);
    expect(PLAYER_SWEEP_MIN_LEAD_MS).toBeLessThan(PLAYER_SWEEP_SPACING_MS);
    expect(leagueWallTime(2026, 10, 3, 19, 45).getTime() - leagueWallTime(2026, 10, 3, 13, 45).getTime()).toBe(
      PLAYER_SWEEP_SPACING_MS,
    );
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

  it("calls the sweep dead an hour past the slot it booked", () => {
    const last = new Date("2026-10-03T17:45:00Z"); // 19:45 CEST, booked 01:45 CEST
    const check = (iso: string) =>
      overdueChains({ ...healthy, sweepLastRunAt: last, now: new Date(iso) }).players;
    expect(check("2026-10-04T00:44:00Z")).toBe(false);
    expect(check("2026-10-04T00:45:00Z")).toBe(true);
  });

  it("does not call a healthy long gap dead", () => {
    // A retry at 20:45 CEST books 07:45, eleven hours on. A constant 7-hour threshold
    // would have revived it at 03:45 and started a second chain beside a healthy one.
    const last = new Date("2026-10-03T18:45:00Z");
    expect(
      overdueChains({ ...healthy, sweepLastRunAt: last, now: new Date("2026-10-04T03:00:00Z") }).players,
    ).toBe(false);
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
    expect(SWEEP_GRACE_MS).toBeGreaterThan(0);
  });
});
