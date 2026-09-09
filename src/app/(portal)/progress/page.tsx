import { db } from "@/lib/db";
import { loadSnapshots } from "@/lib/db/queries";
import { buildSeries } from "@/lib/domain/standings";
import { requireSession } from "@/lib/auth/guards";
import { ProgressCharts } from "@/components/progress-charts";
import { PageHeader } from "@/components/page-header";

export default async function ProgressPage() {
  await requireSession();
  const { snapshots, teams } = await loadSnapshots(db);
  const series = buildSeries(snapshots, teams);

  return (
    <section className="mx-auto max-w-4xl">
      <PageHeader
        title="Progress"
        note="Pin up to three managers to compare them. Everyone else stays as context."
      />

      <div className="mt-8">
        <ProgressCharts series={series} teams={teams} />
      </div>
    </section>
  );
}
