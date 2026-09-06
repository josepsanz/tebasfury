import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { createClient } from "@/lib/fantasy-client";
import { getEnv } from "@/lib/env";
import { scheduleNextRun, verifyQStashSignature } from "@/lib/scheduler";
import { runSync } from "@/lib/sync";

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("upstash-signature") ?? "";

  if (!(await verifyQStashSignature(signature, body))) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  const client = await createClient(db, getEnv().LALIGA_LEAGUE_ID);
  const result = await runSync({
    db,
    client,
    now: new Date(),
    runId: randomUUID(),
    trigger: "schedule",
  });
  await scheduleNextRun(result.nextRunAt);

  return Response.json({
    weeksSynced: result.weeksSynced,
    nextRunAt: result.nextRunAt.toISOString(),
  });
}
