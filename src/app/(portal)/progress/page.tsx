import { db } from "@/lib/db";
import { loadSnapshots } from "@/lib/db/queries";
import { buildSeries } from "@/lib/domain/standings";
import { requireSession } from "@/lib/auth/guards";
import { ProgressCharts } from "@/components/progress-charts";

export default async function ProgressPage() {
  await requireSession();
  const { snapshots, teams, lastSync } = await loadSnapshots(db);
  const series = buildSeries(snapshots, teams);

  return (
    <section className="mx-auto max-w-4xl">
      <h1 className="text-xl font-medium">Progress</h1>
      <p className="mt-1 text-[13px]" style={{ color: "var(--board-ink-dim)" }}>
        Pin up to three managers to compare them. Everyone else stays as context.
      </p>
      <div className="mt-8">
        <ProgressCharts series={series} teams={teams} />
      </div>
      <p className="mt-10 text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
        {lastSync ? `Last synced ${lastSync.toISOString()}` : "Never synced"}
      </p>
    </section>
  );
}
