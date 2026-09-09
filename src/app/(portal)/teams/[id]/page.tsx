import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { loadSnapshots } from "@/lib/db/queries";
import { teamMetrics } from "@/lib/domain/metrics";
import {
  formatAverage,
  formatPointsPerMillion,
  formatRecord,
  formatRegularity,
  formatRoundsPlayed,
  formatStreak,
  formatTrend,
  formatWorstRecord,
} from "@/lib/domain/metric-copy";
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

  const items: Metric[] = [
    { label: "Average", ...formatAverage(metrics.average) },
    { label: "Trend", ...formatTrend(metrics.trend) },
    // No nameOf: the page header already names the one manager these tiles are about
    // (I3) — repeating it in every caption would be the boundary leaking back in.
    { label: "Best round", ...formatRecord(metrics.best) },
    // The zero-exclusion reason belongs in metric-copy.ts alongside the rest of the
    // wording — formatWorstRecord already appends it to the caption.
    { label: "Worst round", ...formatWorstRecord(metrics.worst) },
    { label: "Regularity", ...formatRegularity(metrics.regularity) },
    // formatStreak also takes rounds played: a zero-length streak means "level with
    // the league" only once there is a round to be level on — with none played it is
    // the same "no rounds yet" wording as every other figure on this page. Read from
    // the domain's own settled count, not a local filter, so this can never disagree
    // with what metrics.streak itself was computed from (I1).
    { label: "Streak", ...formatStreak(metrics.streak, metrics.roundsPlayed) },
    { label: "Points per million", ...formatPointsPerMillion(metrics.pointsPerMillion) },
  ];

  return (
    <section className="mx-auto max-w-2xl">
      <PageHeader title={team.managerName} meta={formatRoundsPlayed(metrics.roundsPlayed)} />
      <MetricGrid items={items} />
    </section>
  );
}
