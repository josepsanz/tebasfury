import { db } from "@/lib/db";
import { loadClaimBoard } from "@/lib/claims";
import { decideAccess, requireSession } from "@/lib/auth/guards";
import { ClaimList } from "@/components/claim-list";
import { claim, release } from "./actions";

export default async function ClaimPage() {
  const session = await requireSession();
  const rows = await loadClaimBoard(db);
  const canReleaseAny = decideAccess(session, { leagueData: ["correct"] }).kind === "allow";

  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="text-xl font-medium">Which team is yours?</h1>
      <p className="mt-1 text-[11.5px]" style={{ color: "var(--board-ink-dim)" }}>
        Pick your manager. Only you see the mark — nobody is told who claimed what.
      </p>

      <ClaimList
        rows={rows}
        viewerId={session.user.id}
        canReleaseAny={canReleaseAny}
        claimAction={claim}
        releaseAction={release}
      />
    </section>
  );
}
