import { db } from "@/lib/db";
import { loadSnapshots } from "@/lib/db/queries";
import { loadMyTeam } from "@/lib/claims";
import { buildSeries } from "@/lib/domain/standings";
import { requireSession } from "@/lib/auth/guards";
import { ProgressCharts } from "@/components/progress-charts";
import { PageHeader } from "@/components/page-header";

export default async function ProgressPage() {
  const session = await requireSession();
  const [{ snapshots, teams }, myTeam] = await Promise.all([
    loadSnapshots(db),
    loadMyTeam(db, { userId: session.user.id }),
  ]);
  const series = buildSeries(snapshots, teams);

  return (
    <section className="mx-auto max-w-4xl">
      <PageHeader
        title="Progress"
        note="Pin up to six managers to compare them. Everyone else stays as context."
      />

      <div className="mt-8">
        {/* A manager arriving at their own progress chart is looking for their own line.
            Pinned for them rather than left to a click, and only as the starting state —
            unpinning it holds for the visit. Null for anyone who has not claimed a team
            yet, which is most of the league until they do. */}
        <ProgressCharts series={series} teams={teams} myTeamId={myTeam?.teamId ?? null} />
      </div>
    </section>
  );
}
