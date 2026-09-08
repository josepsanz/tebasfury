"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { claimTeam, releaseTeam, releaseTeamAsAdmin } from "@/lib/claims";
import { decideAccess, requireSession } from "@/lib/auth/guards";

export type ClaimActionResult = { ok: boolean; message: string };

/**
 * The wording of every outcome lives here and nowhere else.
 *
 * `taken` and `already-claimed-another` are not failures: they are what losing a race
 * between friends looks like. They come back as ordinary text and the page re-reads
 * the world, which is the only thing that can be authoritative about it.
 */
export async function claim(formData: FormData): Promise<ClaimActionResult> {
  const session = await requireSession();
  const teamId = String(formData.get("teamId") ?? "");
  if (teamId === "") return { ok: false, message: "No team was named." };

  const outcome = await claimTeam(db, { userId: session.user.id, teamId });
  revalidatePath("/claim");
  revalidatePath("/");
  revalidatePath("/standings");

  if (outcome === "claimed") return { ok: true, message: "That team is yours now." };
  if (outcome === "taken") {
    return { ok: false, message: "Somebody claimed this team first." };
  }
  return { ok: false, message: "You already have a team. Release it first." };
}

/**
 * Releases the caller's own team, or — for whoever may correct league data — the team
 * named in the form. The two are different functions underneath: only the second takes
 * a team id, and only the second checks a permission.
 */
export async function release(formData: FormData): Promise<ClaimActionResult> {
  const session = await requireSession();
  const teamId = String(formData.get("teamId") ?? "");

  const outcome =
    teamId === ""
      ? await releaseTeam(db, { userId: session.user.id })
      : decideAccess(session, { leagueData: ["correct"] }).kind === "allow"
        ? await releaseTeamAsAdmin(db, { teamId })
        : null;

  revalidatePath("/claim");
  revalidatePath("/");
  revalidatePath("/standings");

  if (outcome === null) return { ok: false, message: "That is not yours to release." };
  if (outcome === "released") return { ok: true, message: "Released." };
  return { ok: false, message: "There was nothing to release." };
}
