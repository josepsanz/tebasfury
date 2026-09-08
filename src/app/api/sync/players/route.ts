import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { createClient } from "@/lib/fantasy-client";
import { getEnv } from "@/lib/env";
import { schedulePlayerSweep, verifyQStashSignature } from "@/lib/scheduler";
import { nextPlayerSweepAfterFailure } from "@/lib/sync/next-run";
import { runPlayerSweep } from "@/lib/sync/players";
import { failureMessage, runAndSchedule } from "@/lib/sync/scheduled-run";

/**
 * The platform default (10s on Hobby, 15s on Pro) is well under what a full sweep can
 * take: 1 catalogue fetch, 13 sequential `getSquad` calls, and — the part that grows —
 * a points backfill that is ~9 chunked round trips today and ~16 by the end of a
 * 38-week season. On a timeout the writes already done persist (there is no
 * transaction, correctly), but the `catch` below never runs, so the `sync_runs` row
 * is stuck "running" and `runAndSchedule` never books a successor — the chain the
 * daily cadence depends on goes silently dead. 300s covers a full season's backfill
 * with headroom. Vercel's Hobby plan silently clamps any value above 60s, so a Hobby
 * deployment gets 60s regardless of this constant — see `docs/deployment.md`.
 */
export const maxDuration = 300;

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("upstash-signature") ?? "";

  if (!(await verifyQStashSignature(signature, body))) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  const now = new Date();
  const outcome = await runAndSchedule({
    now,
    schedule: (at) => schedulePlayerSweep(at, now),
    nextAfterFailure: nextPlayerSweepAfterFailure,
    run: async () => {
      const client = await createClient(db, getEnv().LALIGA_LEAGUE_ID);
      return runPlayerSweep({ db, client, now, runId: randomUUID(), trigger: "players-schedule" });
    },
  });

  if (outcome.status === "failed") {
    // A 500 so QStash retries this delivery too: its retries are the fast recovery,
    // and the successor `runAndSchedule` booked is what survives them running out.
    return Response.json({ error: failureMessage(outcome.error) }, { status: 500 });
  }

  return Response.json({
    playersSynced: outcome.result.playersSynced,
    squadsSynced: outcome.result.squadsSynced,
    squadsSkipped: outcome.result.squadsSkipped,
    droppedSquadPlayers: outcome.result.droppedSquadPlayers,
    realTeamsKnown: outcome.result.realTeamsKnown,
    operationsCaptured: outcome.result.operationsCaptured,
    nextRunAt: outcome.result.nextRunAt.toISOString(),
  });
}
