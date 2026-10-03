import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { claimPlayerSweep, markClaimedRunFailed } from "@/lib/db/queries";
import { createClient } from "@/lib/fantasy-client";
import { getEnv } from "@/lib/env";
import { schedulePlayerSweep, verifyQStashSignature } from "@/lib/scheduler";
import { nextPlayerSweepAfterFailure, SWEEP_COLLAPSE_WINDOW_MS } from "@/lib/sync/next-run";
import { describeFailure } from "@/lib/sync/failure";
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

  const runId = randomUUID();

  // The one place a chain is allowed to end on purpose. Standing down without booking a
  // successor is what collapses a duplicate chain — two deliveries of one booking, half a
  // second apart, both swept and both booked on 2026-10-03. The claim is an insert rather
  // than a read so twins cannot both pass it, and it comes before the client is built
  // because that is where their milliseconds go. `claimPlayerSweep` argues why it cannot
  // end the last chain, and why the "Sweep players" button never blocks it.
  const claimed = await claimPlayerSweep(db, {
    runId,
    trigger: "players-schedule",
    now,
    collapseWindowMs: SWEEP_COLLAPSE_WINDOW_MS,
  });
  if (!claimed) {
    return Response.json({
      skipped: true,
      reason: "Another player sweep started within the collapse window.",
    });
  }

  const outcome = await runAndSchedule({
    now,
    schedule: (at) => schedulePlayerSweep(at, now, runId),
    nextAfterFailure: nextPlayerSweepAfterFailure,
    run: async () => {
      const client = await createClient(db, getEnv().LALIGA_LEAGUE_ID);
      return runPlayerSweep({ db, client, now, runId, trigger: "players-schedule" });
    },
  });

  if (outcome.status === "failed") {
    // The claimed row is still `running` if the failure came before `runPlayerSweep` got
    // going — an expired credential, most often. Closing it keeps the history honest.
    await markClaimedRunFailed(db, { runId, now: new Date(), error: describeFailure(outcome.error) });

    // A 500 so QStash retries this delivery too: its retries are the fast recovery,
    // and the successor `runAndSchedule` booked is what survives them running out.
    return Response.json({ error: failureMessage(outcome.error) }, { status: 500 });
  }

  return Response.json({
    playersSynced: outcome.result.playersSynced,
    squadsSynced: outcome.result.squadsSynced,
    squadsSkipped: outcome.result.squadsSkipped,
    droppedSquadPlayers: outcome.result.droppedSquadPlayers,
    squadsDeparted: outcome.result.squadsDeparted,
    realTeamsKnown: outcome.result.realTeamsKnown,
    operationsCaptured: outcome.result.operationsCaptured,
    // Lineups are the sweep's one silently-retried failure (see `captureLineups`), and
    // this endpoint's JSON is the other channel an operator — or a monitor watching
    // it — could read that from, alongside the admin page's notes.
    lineupsCaptured: outcome.result.lineupsCaptured,
    marketCaptured: outcome.result.marketCaptured,
    marketFailed: outcome.result.marketFailed,
    nextRunAt: outcome.result.nextRunAt.toISOString(),
  });
}
