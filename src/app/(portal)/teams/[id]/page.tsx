import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { loadSnapshots } from "@/lib/db/queries";
import { teamMetrics } from "@/lib/domain/metrics";
import { formatRecord, formatTrend, formatWorstRecord } from "@/lib/domain/metric-copy";
import { requireSession } from "@/lib/auth/guards";
import { PageHeader } from "@/components/page-header";
import { MetricGrid, type Metric } from "@/components/metric-grid";

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  const { snapshots, teams } = await loadSnapshots(db);

  const team = teams.find((candidate) => candidate.id === id);
  // A 404, not a page of dashes: an id that matches nothing is a wrong address, and
  // rendering seven "no rounds yet" figures would suggest the manager merely had a
  // quiet season.
  if (!team) notFound();

  const metrics = teamMetrics(snapshots, id);
  const nameOf = () => team.managerName;
  const rounds = snapshots.filter((row) => row.teamId === id).length;

  const items: Metric[] = [
    { label: "Average", value: metrics.average === null ? "No rounds yet" : String(metrics.average) },
    { label: "Trend", ...formatTrend(metrics.trend) },
    { label: "Best round", ...formatRecord(metrics.best, nameOf) },
    // The zero-exclusion reason belongs in metric-copy.ts alongside the rest of the
    // wording — formatWorstRecord already appends it to the caption.
    { label: "Worst round", ...formatWorstRecord(metrics.worst, nameOf) },
    {
      label: "Regularity",
      value: metrics.regularity === null ? "Needs two rounds" : `± ${metrics.regularity} pts`,
      note: metrics.regularity === null ? undefined : "Lower is steadier",
    },
    {
      label: "Streak",
      value:
        metrics.streak.rounds === 0
          ? "Level with the league"
          : `${metrics.streak.rounds} ${metrics.streak.rounds === 1 ? "round" : "rounds"} ${metrics.streak.above ? "above" : "below"}`,
      tone: metrics.streak.rounds === 0 ? undefined : metrics.streak.above ? "up" : "down",
    },
    {
      label: "Points per million",
      value:
        metrics.pointsPerMillion === null
          ? "No squad value recorded"
          : String(metrics.pointsPerMillion),
    },
  ];

  return (
    <section className="mx-auto max-w-2xl">
      <PageHeader title={team.managerName} meta={`${rounds} rounds`} />
      <MetricGrid items={items} />
    </section>
  );
}
