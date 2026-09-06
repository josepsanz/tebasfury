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

  try {
    const client = await createClient(db, getEnv().LALIGA_LEAGUE_ID);
    const result = await runSync({
      db,
      client,
      now: new Date(),
      runId: randomUUID(),
      trigger: "manual",
    });
    await scheduleNextRun(result.nextRunAt);
    revalidatePath("/standings");
    revalidatePath("/progress");
    revalidatePath("/admin/sync");
    return {
      ok: true,
      message: `Synced ${result.weeksSynced.length} gameweek(s). Next run at ${result.nextRunAt.toISOString()}.`,
    };
  } catch (error) {
    if (error instanceof CredentialError) {
      return {
        ok: false,
        message:
          "The stored credential no longer works. Sign in at miliga.laliga.com, capture a new " +
          "refresh token from the network tab, and paste it above. See spike/README.md.",
      };
    }
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
