import { Client, Receiver } from "@upstash/qstash";
import { getEnv } from "@/lib/env";

/** QStash takes a delay in whole seconds, and refuses a negative one. */
export function delaySecondsUntil(at: Date, now: Date): number {
  return Math.max(0, Math.floor((at.getTime() - now.getTime()) / 1000));
}

/**
 * Publishes the next sync to QStash.
 *
 * The chain is self-scheduling: each run books its own successor, so there is no
 * fixed cron making calls while nothing is happening.
 */
export async function scheduleNextRun(at: Date, now: Date = new Date()): Promise<void> {
  const client = new Client({ token: getEnv().QSTASH_TOKEN });
  await client.publishJSON({
    url: `${getEnv().BETTER_AUTH_URL}/api/sync`,
    delay: delaySecondsUntil(at, now),
    body: { trigger: "schedule" },
  });
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
