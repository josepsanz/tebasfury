"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { saveRefreshToken } from "@/lib/fantasy-client/credentials";
import { CredentialError, createClient } from "@/lib/fantasy-client";
import { getEnv } from "@/lib/env";
import { requirePermission } from "@/lib/auth/guards";
import { scheduleNextRun } from "@/lib/scheduler";
import { runSync } from "@/lib/sync";
import { failureMessage, runAndSchedule } from "@/lib/sync/scheduled-run";
import { CREDENTIAL_RECOVERY_MESSAGE } from "./credential-state";

/** The public client id of the LaLiga web app, which is what issues the token. */
const CLIENT_ID = "6457fa17-1224-416a-b21a-ee6ce76e9bc0";

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

export async function bootstrapCredential(formData: FormData): Promise<ActionResult> {
  const session = await requirePermission({ sync: ["trigger"] });
  const token = String(formData.get("refreshToken") ?? "").trim();

  if (token.length < 100) {
    return { ok: false, message: "That does not look like a refresh token." };
  }

  await saveRefreshToken(db, {
    refreshToken: token,
    clientId: CLIENT_ID,
    updatedBy: session.user.id,
  });
  revalidatePath("/admin/sync");
  return { ok: true, message: "Credential stored. Run a sync to check it works." };
}

export async function triggerSyncNow(): Promise<ActionResult> {
  await requirePermission({ sync: ["trigger"] });

  const now = new Date();
  // Through `runAndSchedule` like the endpoint, so a manual run that fails also
  // leaves a successor behind: the chain may well be the thing that is broken, and
  // this button is where someone comes to find out.
  const outcome = await runAndSchedule({
    now,
    schedule: (at) => scheduleNextRun(at, now),
    run: async () => {
      const client = await createClient(db, getEnv().LALIGA_LEAGUE_ID);
      return runSync({ db, client, now, runId: randomUUID(), trigger: "manual" });
    },
  });

  if (outcome.status === "failed") {
    if (outcome.error instanceof CredentialError) {
      return { ok: false, message: CREDENTIAL_RECOVERY_MESSAGE };
    }
    return { ok: false, message: failureMessage(outcome.error) };
  }

  revalidatePath("/standings");
  revalidatePath("/progress");
  revalidatePath("/admin/sync");
  const { weeksSynced, nextRunAt } = outcome.result;
  return {
    ok: true,
    message: `Synced ${weeksSynced.length} gameweek(s). Next run at ${nextRunAt.toISOString()}.`,
  };
}
