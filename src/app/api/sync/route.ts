import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { createClient } from "@/lib/fantasy-client";
import { getEnv } from "@/lib/env";
import { scheduleNextRun, verifyQStashSignature } from "@/lib/scheduler";
import { runSync } from "@/lib/sync";
import { failureMessage, runAndSchedule } from "@/lib/sync/scheduled-run";

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("upstash-signature") ?? "";

  if (!(await verifyQStashSignature(signature, body))) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  const now = new Date();
  const outcome = await runAndSchedule({
    now,
    schedule: (at) => scheduleNextRun(at, now),
    run: async () => {
      const client = await createClient(db, getEnv().LALIGA_LEAGUE_ID);
      return runSync({ db, client, now, runId: randomUUID(), trigger: "schedule" });
    },
  });

  if (outcome.status === "failed") {
    // A 500 so QStash retries this delivery too: its retries are the fast recovery,
    // and the successor `runAndSchedule` booked is what survives them running out.
    return Response.json({ error: failureMessage(outcome.error) }, { status: 500 });
  }

  return Response.json({
    weeksSynced: outcome.result.weeksSynced,
    nextRunAt: outcome.result.nextRunAt.toISOString(),
  });
}
