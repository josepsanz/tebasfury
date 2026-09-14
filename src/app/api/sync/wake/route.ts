import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { claimStandingsRun, loadChainHeartbeats, markClaimedRunFailed } from "@/lib/db/queries";
import { createClient } from "@/lib/fantasy-client";
import { getEnv } from "@/lib/env";
import { scheduleNextRun, schedulePlayerSweep, verifyQStashSignature } from "@/lib/scheduler";
import { nextPlayerSweepAfterFailure, overdueChains, SYNC_COLLAPSE_WINDOW_MS } from "@/lib/sync/next-run";
import { runSync } from "@/lib/sync";
import { runPlayerSweep } from "@/lib/sync/players";
import { describeFailure } from "@/lib/sync/failure";
import { failureMessage, runAndSchedule } from "@/lib/sync/scheduled-run";

/**
 * Long, because a revival is a full run: this endpoint does nothing at all almost every
 * time, and the once it does something it does exactly what `/api/sync/players` does.
 */
export const maxDuration = 300;

/**
 * The dead man's switch.
 *
 * Both cadences are self-scheduling: every run books its successor, and there is no cron
 * behind either of them. That is a deliberate design with one hole, and on 2026-09-14 the
 * hole opened — a booking was rejected by QStash, the run that made it ended without a
 * successor, and the standings stopped dead in the middle of a live gameweek. Nothing
 * inside the design could notice, because the 24-hour heartbeat that rediscovers a lost
 * schedule is itself a booked message. It took a person pressing "Sync now" to come back.
 *
 * So the watchdog lives OUTSIDE the chains, in a QStash schedule — a cron registered with
 * the service rather than a message any run has to remember to publish. It cannot be lost
 * the way a booking can, and it is deliberately not a Vercel cron: the Hobby plan refuses
 * anything more frequent than daily, and a deploy that fails over a watchdog would be a
 * poor joke.
 *
 * It asks one question — "is either chain dead?" — and on almost every firing the answer
 * is no and it has cost one query. `overdueChains` holds the thresholds and the argument
 * for each; what matters here is that they sit well beyond the longest HEALTHY gap, so a
 * sleeping chain between gameweeks is never mistaken for a stopped one.
 */
export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("upstash-signature") ?? "";

  if (!(await verifyQStashSignature(signature, body))) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  const now = new Date();
  const heartbeats = await loadChainHeartbeats(db);
  const dead = overdueChains({
    standingsLastRunAt: heartbeats.standingsAt,
    sweepLastRunAt: heartbeats.sweepAt,
    isLive: heartbeats.isLive,
    now,
  });

  if (!dead.standings && !dead.players) {
    return Response.json({
      revived: [],
      standingsAt: heartbeats.standingsAt?.toISOString() ?? null,
      sweepAt: heartbeats.sweepAt?.toISOString() ?? null,
    });
  }

  const revived: string[] = [];
  const failures: string[] = [];

  if (dead.standings) {
    const runId = randomUUID();
    // Claimed like any other scheduled run, so two overlapping deliveries of this
    // schedule cannot revive the same chain twice. A dead chain always wins the claim.
    const claimed = await claimStandingsRun(db, {
      runId,
      trigger: "wake",
      now,
      collapseWindowMs: SYNC_COLLAPSE_WINDOW_MS,
    });

    if (claimed) {
      const outcome = await runAndSchedule({
        now,
        schedule: (at) => scheduleNextRun(at, now, runId),
        run: async () => {
          const client = await createClient(db, getEnv().LALIGA_LEAGUE_ID);
          return runSync({ db, client, now, runId, trigger: "wake" });
        },
      });

      if (outcome.status === "failed") {
        await markClaimedRunFailed(db, {
          runId,
          now: new Date(),
          error: describeFailure(outcome.error),
        });
        failures.push(`standings: ${failureMessage(outcome.error)}`);
      } else {
        revived.push("standings");
      }
    }
  }

  if (dead.players) {
    // No collapse guard on this one: `overdueChains` has already established that the
    // sweep has not run in seven hours, which is two hours past the window that guard
    // uses. Asking it again would only be asking the same question twice.
    const runId = randomUUID();
    const outcome = await runAndSchedule({
      now,
      schedule: (at) => schedulePlayerSweep(at, now, runId),
      nextAfterFailure: nextPlayerSweepAfterFailure,
      run: async () => {
        const client = await createClient(db, getEnv().LALIGA_LEAGUE_ID);
        return runPlayerSweep({ db, client, now, runId, trigger: "players-wake" });
      },
    });

    if (outcome.status === "failed") {
      failures.push(`players: ${failureMessage(outcome.error)}`);
    } else {
      revived.push("players");
    }
  }

  // A 500 so the schedule's own delivery is retried: a revival that failed leaves the
  // chain exactly as dead as it found it, and the next firing is half an hour away.
  if (failures.length > 0) {
    return Response.json({ revived, failures }, { status: 500 });
  }

  return Response.json({ revived });
}
