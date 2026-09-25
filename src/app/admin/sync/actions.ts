"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { saveRefreshToken } from "@/lib/fantasy-client/credentials";
import { CredentialError, createClient } from "@/lib/fantasy-client";
import { getEnv } from "@/lib/env";
import { requirePermission } from "@/lib/auth/guards";
import { addAllowedEmails, existingAllowedEmails, removeAllowedEmail } from "@/lib/access";
import { parseAllowlist } from "@/lib/auth/allowlist";
import { runSync } from "@/lib/sync";
import { nextPlayerSweepAfterFailure } from "@/lib/sync/next-run";
import { runPlayerSweep } from "@/lib/sync/players";
import { failureMessage, runAndSchedule } from "@/lib/sync/scheduled-run";
import { CREDENTIAL_RECOVERY_MESSAGE } from "./credential-state";

/** The public client id of the LaLiga web app, which is what issues the token. */
const CLIENT_ID = "6457fa17-1224-416a-b21a-ee6ce76e9bc0";

/** Enough to catch a typo, not a validator. Google decides what actually exists. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const runId = randomUUID();
  // This button syncs. It does NOT book a successor, and that is a change made on
  // 2026-09-14 after watching it fork the chain in production: a manual run that books one
  // starts a SECOND chain, offset from the first by however long ago the button was
  // pressed, and the collapse guard in `/api/sync` only catches deliveries within two
  // minutes of each other — sized for twins born milliseconds apart, useless against five
  // minutes of offset. The league then paid for two of every call, exactly as it had that
  // morning for a different reason.
  //
  // Booking was only ever here to revive a chain that had died. `/api/sync/wake` does that
  // now, from outside, every half hour — so the button can go back to meaning what it says.
  const outcome = await runAndSchedule({
    now,
    schedule: async () => {},
    run: async () => {
      const client = await createClient(db, getEnv().LALIGA_LEAGUE_ID);
      return runSync({ db, client, now, runId, trigger: "manual" });
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

export async function triggerPlayerSweepNow(): Promise<ActionResult> {
  await requirePermission({ sync: ["trigger"] });

  const now = new Date();
  const runId = randomUUID();
  // No successor booked, for the reason the standings button above gives at length. This
  // chain's own collapse window (five hours against a six-hour cadence) would have absorbed
  // a forked chain within one revolution, so this one was never doing harm — but the rule
  // is worth being the same in both places: the buttons sync, the chains schedule
  // themselves, and the watchdog revives whichever has stopped.
  const outcome = await runAndSchedule({
    now,
    schedule: async () => {},
    nextAfterFailure: nextPlayerSweepAfterFailure,
    run: async () => {
      const client = await createClient(db, getEnv().LALIGA_LEAGUE_ID);
      return runPlayerSweep({ db, client, now, runId, trigger: "players-manual" });
    },
  });

  if (outcome.status === "failed") {
    if (outcome.error instanceof CredentialError) {
      return { ok: false, message: CREDENTIAL_RECOVERY_MESSAGE };
    }
    return { ok: false, message: failureMessage(outcome.error) };
  }

  revalidatePath("/players");
  revalidatePath("/market");
  revalidatePath("/admin/sync");
  const {
    playersSynced,
    squadsSynced,
    squadsSkipped,
    droppedSquadPlayers,
    squadsDeparted,
    realTeamsKnown,
    operationsCaptured,
    lineupsFailed,
    droppedLineupPlayers,
    nextRunAt,
  } = outcome.result;
  // The counts below are usually all zero and add nothing when they are — they only
  // appear when there is something an operator would want to see: a squad that looked
  // implausible and was left alone, a player id the catalogue did not recognise, or a
  // lineup that failed and is silently retried next sweep — see `captureLineups`,
  // which is the one place that failure is otherwise invisible.
  const notes = [
    squadsDeparted > 0 ? `${squadsDeparted} manager(s) found to have left the league` : null,
    squadsSkipped > 0 ? `${squadsSkipped} squad(s) left unchanged (empty response)` : null,
    droppedSquadPlayers > 0 ? `${droppedSquadPlayers} unknown squad id(s) dropped` : null,
    lineupsFailed > 0 ? `${lineupsFailed} lineup(s) failed (retried next sweep)` : null,
    droppedLineupPlayers > 0 ? `${droppedLineupPlayers} unknown lineup id(s) dropped` : null,
  ].filter((note): note is string => note !== null);

  return {
    ok: true,
    // Club coverage is reported on every sweep rather than joining `notes`, which
    // appear only when non-zero. Ruling 1 accepts the coverage may never be complete,
    // and a number that shows up only when something is wrong cannot show a gap
    // closing.
    message:
      `Swept ${playersSynced} players and ${squadsSynced} squads, ` +
      `${realTeamsKnown} clubs known, ${operationsCaptured} operations captured` +
      (notes.length > 0 ? ` (${notes.join(", ")})` : "") +
      `. Next sweep at ${nextRunAt.toISOString()}.`,
  };
}

/**
 * Adds addresses to the sign-in list.
 *
 * Guarded by `access: ["manage"]`, which only the admin role holds — a collaborator who
 * may trigger a sync must not also decide who reaches the league.
 *
 * The reply counts what actually changed rather than what was submitted: pasting five
 * addresses of which three were already there is "2 added", not "5 added". Saying five
 * would be a small lie that costs a real minute the day somebody is bounced.
 */
export async function allowEmails(formData: FormData): Promise<ActionResult> {
  const session = await requirePermission({ access: ["manage"] });

  const emails = parseAllowlist(String(formData.get("emails") ?? ""));
  if (emails.length === 0) return { ok: false, message: "No address was given." };

  const invalid = emails.filter((email) => !EMAIL.test(email));
  if (invalid.length > 0) {
    return { ok: false, message: `Not an email address: ${invalid.join(", ")}` };
  }

  const already = await existingAllowedEmails(db, emails);
  const added = await addAllowedEmails(db, { emails, addedBy: session.user.id });
  revalidatePath("/admin/sync");

  if (added === 0) return { ok: true, message: "Already on the list — nothing to add." };
  const note = already.length > 0 ? ` ${already.length} already there.` : "";
  return { ok: true, message: `${added} added.${note}` };
}

/**
 * Takes one address off the list.
 *
 * This stops them signing in AGAIN; it does not end a session they already hold, which
 * runs for seven days. The screen says so, because a silent seven-day tail on a removal
 * is exactly the kind of thing an owner assumes is instant.
 */
export async function disallowEmail(formData: FormData): Promise<ActionResult> {
  await requirePermission({ access: ["manage"] });

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (email === "") return { ok: false, message: "No address was named." };

  const removed = await removeAllowedEmail(db, email);
  revalidatePath("/admin/sync");

  return removed
    ? { ok: true, message: `${email} removed. Any session they already hold runs until it expires.` }
    : { ok: false, message: "That address was not on the list." };
}
