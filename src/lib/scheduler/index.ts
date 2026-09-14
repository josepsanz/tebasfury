import { Client, Receiver } from "@upstash/qstash";
import { getEnv } from "@/lib/env";

/** QStash takes a delay in whole seconds, and refuses a negative one. */
export function delaySecondsUntil(at: Date, now: Date): number {
  return Math.max(0, Math.floor((at.getTime() - now.getTime()) / 1000));
}

/**
 * The deduplication id one run's booking carries.
 *
 * A run books exactly one successor, so the id names the run rather than the instant it
 * booked: every attempt at that one publish carries the same id, and QStash accepts a
 * repeat without enqueueing it. That is the difference between a publish the SDK retried
 * because a response was lost and a second chain.
 *
 * It must NOT be the target instant, tempting as that is. Ids are remembered for ninety
 * days, and while a chain idles between gameweeks every run computes the same absolute
 * opening time — so an instant-shaped id would silently swallow the booking made by
 * "Sync now", which is the one lever that revives a chain that has died.
 *
 * **A rejected id takes the chain with it.** `publishJSON` throws, the run books nothing,
 * and there is no cron behind it to notice — which is exactly what happened on
 * 2026-09-14 with a colon in here. The shape is pinned by a test for that reason.
 */
export function bookingId(trigger: string, runId: string): string {
  // A hyphen, and never a colon: QStash reserves that one and rejects the whole publish
  // with `DeduplicationId cannot contain ':'`. It cost the chain twenty minutes to learn.
  return `${trigger}-${runId}`;
}

/** One QStash publish. The two cadences differ only in the endpoint they wake. */
async function publish(
  path: string,
  trigger: string,
  at: Date,
  now: Date,
  runId: string,
): Promise<void> {
  const client = new Client({ token: getEnv().QSTASH_TOKEN });
  await client.publishJSON({
    url: `${getEnv().BETTER_AUTH_URL}${path}`,
    delay: delaySecondsUntil(at, now),
    body: { trigger },
    deduplicationId: bookingId(trigger, runId),
  });
}

/**
 * Publishes the next standings sync to QStash.
 *
 * The chain is self-scheduling: each run books its own successor, so there is no
 * fixed cron making calls while nothing is happening.
 */
export async function scheduleNextRun(at: Date, now: Date, runId: string): Promise<void> {
  await publish("/api/sync", "schedule", at, now, runId);
}

/**
 * Publishes the next player sweep, on its own chain.
 *
 * Separate from the standings chain on purpose: player data does not move every ten
 * minutes, and the two cadences must not be able to drag each other along.
 */
export async function schedulePlayerSweep(at: Date, now: Date, runId: string): Promise<void> {
  await publish("/api/sync/players", "players-schedule", at, now, runId);
}

export async function verifyQStashSignature(signature: string, body: string): Promise<boolean> {
  const receiver = new Receiver({
    currentSigningKey: getEnv().QSTASH_CURRENT_SIGNING_KEY,
    nextSigningKey: getEnv().QSTASH_NEXT_SIGNING_KEY,
  });
  try {
    return await receiver.verify({ signature, body });
  } catch {
    return false;
  }
}
