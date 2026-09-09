import { db } from "@/lib/db";
import { loadClaimBoard } from "@/lib/claims";
import { decideAccess, requireSession } from "@/lib/auth/guards";
import { ClaimList } from "@/components/claim-list";
import { PageHeader } from "@/components/page-header";
import { claim, release } from "./actions";

export default async function ClaimPage() {
  const session = await requireSession();
  const rows = await loadClaimBoard(db);
  const canReleaseAny = decideAccess(session, { leagueData: ["correct"] }).kind === "allow";

  return (
    <section className="mx-auto max-w-2xl">
      <PageHeader
        title="Which team is yours?"
        note="Pick your manager. Only you see the mark — nobody is told who claimed what."
        meta={`${rows.length} teams`}
      />

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
