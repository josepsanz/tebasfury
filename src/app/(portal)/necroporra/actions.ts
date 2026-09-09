"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { loadSnapshots } from "@/lib/db/queries";
import { loadMyTeam } from "@/lib/claims";
import { castVotes, loadRound } from "@/lib/necroporra";
import { isOpen, validatePair, type PairRejection } from "@/lib/domain/necroporra";
import { requireSession } from "@/lib/auth/guards";

export type VoteResult = { ok: boolean; message: string };

/** The wording of every refusal, in one place, as the claim slice keeps it. */
const REFUSALS: Record<PairRejection, string> = {
  empty: "Pick at least one team.",
  "too-many": "Two teams at most.",
  duplicate: "That is the same team twice.",
  "own-team": "You cannot pick your own team.",
  "unknown-team": "That team is not in this league.",
};

/**
 * Records the caller's picks for the round.
 *
 * Every rule is re-checked here rather than trusted from the form. The page hides an
 * illegal option, but a hidden option is a courtesy and not a control: the deadline, the
 * caller's own team, and the shape of the pair are all decided again on the server,
 * against the world as it is at this instant rather than as it was when the page
 * rendered. The deadline especially — a form left open in a tab outlives its round.
 */
export async function vote(formData: FormData): Promise<VoteResult> {
  const session = await requireSession();

  const gameweek = Number(formData.get("gameweek"));
  if (!Number.isInteger(gameweek)) return { ok: false, message: "No round was named." };

  const now = new Date();
  const round = await loadRound(db, gameweek);
  if (!isOpen(round, now)) {
    return { ok: false, message: "Voting for this round has closed." };
  }

  // Voting is per manager, and the claimed team is also what supplies the team you may
  // not pick — so an account with no claim has nothing to vote with, not merely nothing
  // to exclude.
  const myTeam = await loadMyTeam(db, { userId: session.user.id });
  if (myTeam === null) {
    return { ok: false, message: "Claim your team first — the Necroporra is per manager." };
  }

  const picks = formData.getAll("teamId").map(String).filter((id) => id !== "");
  const { teams } = await loadSnapshots(db);
  const verdict = validatePair(picks, {
    ownTeamId: myTeam.teamId,
    teamIds: teams.map((t) => t.id),
  });
  if (!verdict.ok) return { ok: false, message: REFUSALS[verdict.reason] };

  await castVotes(db, { gameweek, userId: session.user.id, picks, now });
  revalidatePath("/necroporra");

  return { ok: true, message: "Your picks are in." };
}
