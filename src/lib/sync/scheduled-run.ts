import type { SyncResult } from "./index";
import { nextRunAfterFailure } from "./next-run";

export type ScheduledRun =
  | { status: "succeeded"; result: SyncResult }
  | { status: "failed"; error: unknown };

/**
 * Runs a sync and books its successor — whether or not the run worked.
 *
 * The self-scheduling chain is the only scheduler in the design. There is no cron: if
 * a run publishes nothing, nothing ever calls `/api/sync` again. A Zod parse error
 * after the next API change, a 5xx from LaLiga, a Neon blip, an expired credential or
 * a function timeout would all have ended it. QStash's delivery retries buy hours;
 * after that the portal stops syncing for good, silently, and only a person pressing
 * "Sync now" brings it back.
 *
 * So the successor is booked on both paths, and the caller still gets the failure to
 * report — a 500 on the endpoint, so QStash retries the delivery as well. Its retries
 * are the fast recovery; this booking is what survives them running out.
 *
 * The rebooking is itself allowed to fail without masking the original error: if
 * QStash is the thing that is down, there is nothing further to try, and the daily
 * cap in `decideNextRun` is what the next successful run restores.
 */
export async function runAndSchedule(deps: {
  run: () => Promise<SyncResult>;
  schedule: (at: Date) => Promise<void>;
  now: Date;
}): Promise<ScheduledRun> {
  try {
    const result = await deps.run();
    await deps.schedule(result.nextRunAt);
    return { status: "succeeded", result };
  } catch (error) {
    try {
      await deps.schedule(nextRunAfterFailure(deps.now));
    } catch {
      // Nothing left to do here. The run's own error is the one worth reporting.
    }
    return { status: "failed", error };
  }
}

/** The text a caller shows for a failed run. */
export function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
