"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { loadSnapshots } from "@/lib/db/queries";
import { loadMyTeam } from "@/lib/claims";
import { castVotes, loadRound } from "@/lib/necroporra";
import { canCastFor, isOpen, validatePair, type PairRejection } from "@/lib/domain/necroporra";
import { decideAccess, requireSession } from "@/lib/auth/guards";

export type VoteResult = { ok: boolean; message: string };

/** The wording of every refusal, in one place, as the claim slice keeps it. */
const REFUSALS: Record<PairRejection, string> = {
  empty: "Pick at least one team.",
  "too-many": "Two teams at most.",
  duplicate: "That is the same team twice.",
  "own-team": "That team cannot pick itself.",
  "unknown-team": "That team is not in this league.",
};

/**
 * Records picks for the round — the caller's own, or a manager's that an admin is
 * entering for them.
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
  // The deadline moves for a ballot somebody enters on another's behalf; the round's
  // existence does not. A gameweek nobody opened a round for was never a poll.
  if (round === null) return { ok: false, message: "No round exists for that gameweek." };

  const myTeam = await loadMyTeam(db, { userId: session.user.id });
  const mayCastForOthers = decideAccess(session, { poll: ["voteFor"] }).kind === "allow";

  // The form names a team only when somebody is filling in a row that is not theirs. A
  // manager voting for themselves sends nothing and gets their own.
  const asked = formData.get("forTeamId");
  const targetTeamId =
    typeof asked === "string" && asked !== "" ? asked : (myTeam?.teamId ?? null);
  if (targetTeamId === null) {
    return { ok: false, message: "Claim your team first — the Necroporra is per manager." };
  }

  if (!canCastFor({ teamId: myTeam?.teamId ?? null, mayCastForOthers }, targetTeamId)) {
    return { ok: false, message: "That is not your ballot." };
  }

  const onBehalf = targetTeamId !== myTeam?.teamId;

  // An open round belongs to the league as it is now: a manager who has left neither
  // votes in it nor may be voted for. A closed round is history, and an admin entering a
  // ballot for it picks from everyone who was in the league then.
  const { teams, activeTeams } = await loadSnapshots(db);
  const eligible = isOpen(round, now) ? activeTeams : teams;
  if (!eligible.some((t) => t.id === targetTeamId)) {
    return { ok: false, message: "That manager has left the league." };
  }

  // Your own vote shuts at kickoff, whoever you are — an admin does not get to vote late
  // for themselves. An ENTERED ballot does not shut: it was cast elsewhere and on time,
  // and only the typing is late. That privilege is paid for in the open, by the mark the
  // page draws naming who entered it.
  if (!onBehalf && !isOpen(round, now)) {
    return { ok: false, message: "Voting for this round has closed." };
  }

  const picks = formData.getAll("teamId").map(String).filter((id) => id !== "");
  const verdict = validatePair(picks, {
    // The TARGET's own team, not the caller's: "not your own team" is a rule about whose
    // ballot it is, and an admin filling in Ana's row must not be able to make her pick
    // herself — nor be stopped from letting her pick the admin's team.
    ownTeamId: targetTeamId,
    teamIds: eligible.map((t) => t.id),
  });
  if (!verdict.ok) return { ok: false, message: REFUSALS[verdict.reason] };

  await castVotes(db, {
    gameweek,
    teamId: targetTeamId,
    picks,
    now,
    enteredBy: onBehalf ? session.user.id : null,
  });
  revalidatePath("/necroporra");

  return { ok: true, message: onBehalf ? "Their picks are in." : "Your picks are in." };
}
