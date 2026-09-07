import { Client, Receiver } from "@upstash/qstash";
import { getEnv } from "@/lib/env";

/** QStash takes a delay in whole seconds, and refuses a negative one. */
export function delaySecondsUntil(at: Date, now: Date): number {
  return Math.max(0, Math.floor((at.getTime() - now.getTime()) / 1000));
}

/** One QStash publish. The two cadences differ only in the endpoint they wake. */
async function publish(path: string, trigger: string, at: Date, now: Date): Promise<void> {
  const client = new Client({ token: getEnv().QSTASH_TOKEN });
  await client.publishJSON({
    url: `${getEnv().BETTER_AUTH_URL}${path}`,
    delay: delaySecondsUntil(at, now),
    body: { trigger },
  });
}

/**
 * Publishes the next standings sync to QStash.
 *
 * The chain is self-scheduling: each run books its own successor, so there is no
 * fixed cron making calls while nothing is happening.
 */
export async function scheduleNextRun(at: Date, now: Date = new Date()): Promise<void> {
  await publish("/api/sync", "schedule", at, now);
}

/**
 * Publishes the next player sweep, on its own chain.
 *
 * Separate from the standings chain on purpose: player data does not move every ten
 * minutes, and the two cadences must not be able to drag each other along.
 */
export async function schedulePlayerSweep(at: Date, now: Date = new Date()): Promise<void> {
  await publish("/api/sync/players", "players-schedule", at, now);
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
