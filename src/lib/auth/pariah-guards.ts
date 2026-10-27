import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { loadMyTeam } from "@/lib/claims";
import { decidePariahTeamAccess, isPariah, PARIAH_PAGE } from "./access-decision";

type SessionLike = Parameters<typeof isPariah>[0];

/**
 * Sends a pariah to `/pariah` from a page the league has closed to them: the players,
 * one player, the market and the targets.
 *
 * Called on the destination, never by hiding links. Every link in the portal stays where
 * it is, so a pariah who clicks one of their own players or a rival in the standings
 * meets the ban at the page they were reaching for — and so does one who types the URL.
 *
 * Kept out of `guards.ts` so the page tests, which fake that module for its session,
 * still run this one for real.
 */
export function refusePariah(session: SessionLike): void {
  if (isPariah(session)) redirect(PARIAH_PAGE);
}

/** The same, for a team page: a pariah may still look at their own. */
export async function refusePariahUnlessOwnTeam(session: SessionLike, teamId: string) {
  if (!session || !isPariah(session)) return;
  const myTeam = await loadMyTeam(db, { userId: session.user.id });
  const decision = decidePariahTeamAccess(session, teamId, myTeam?.teamId ?? null);
  if (decision.kind === "redirect") redirect(decision.to);
}
