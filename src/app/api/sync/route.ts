import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { claimStandingsRun, markClaimedRunFailed } from "@/lib/db/queries";
import { createClient } from "@/lib/fantasy-client";
import { getEnv } from "@/lib/env";
import { scheduleNextRun, verifyQStashSignature } from "@/lib/scheduler";
import { SYNC_COLLAPSE_WINDOW_MS } from "@/lib/sync/next-run";
import { runSync } from "@/lib/sync";
import { describeFailure } from "@/lib/sync/failure";
import { failureMessage, runAndSchedule } from "@/lib/sync/scheduled-run";

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("upstash-signature") ?? "";

  if (!(await verifyQStashSignature(signature, body))) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  const now = new Date();

  const runId = randomUUID();

  // The one place this chain is allowed to end on purpose, and the counterpart of the
  // sweep's guard in `/api/sync/players`. Standing down without booking a successor is
  // what collapses a fork: on 2026-09-11 a single booking was delivered twice, 70 ms
  // apart, and both deliveries became chains that ran double for four days. The claim is
  // an insert rather than a read so that twins milliseconds apart cannot both pass it,
  // and it happens before the client is built because that is where those milliseconds
  // go. `claimStandingsRun` argues why this cannot end the last chain.
  const claimed = await claimStandingsRun(db, {
    runId,
    trigger: "schedule",
    now,
    collapseWindowMs: SYNC_COLLAPSE_WINDOW_MS,
  });
  if (!claimed) {
    return Response.json({
      skipped: true,
      reason: "Another standings run started within the collapse window.",
    });
  }

  const outcome = await runAndSchedule({
    now,
    schedule: (at) => scheduleNextRun(at, now, runId),
    run: async () => {
      const client = await createClient(db, getEnv().LALIGA_LEAGUE_ID);
      return runSync({ db, client, now, runId, trigger: "schedule" });
    },
  });

  if (outcome.status === "failed") {
    // The claimed row is still `running` if the failure happened before `runSync` got
    // going — an expired credential, most often. Closing it keeps the history honest, and
    // `describeFailure` rather than `failureMessage` because the name is what
    // `isCredentialFailure` reads to tell an admin the credential is the thing to fix.
    await markClaimedRunFailed(db, {
      runId,
      now: new Date(),
      error: describeFailure(outcome.error),
    });

    // A 500 so QStash retries this delivery too: its retries are the fast recovery,
    // and the successor `runAndSchedule` booked is what survives them running out.
    return Response.json({ error: failureMessage(outcome.error) }, { status: 500 });
  }

  return Response.json({
    weeksSynced: outcome.result.weeksSynced,
    nextRunAt: outcome.result.nextRunAt.toISOString(),
  });
}
