import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { loadMarket, loadSnapshots } from "@/lib/db/queries";
import { teamMetrics } from "@/lib/domain/metrics";
import { marketSummary } from "@/lib/domain/market";
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
import { MarketMoney } from "@/components/market-money";
import { MarketFeed } from "@/components/market-feed";

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

  // The whole market, filtered inside the feed rather than before it — see MarketFeed's
  // note on why a per-manager filter must not be applied to the holding arithmetic.
  const market = await loadMarket(db);
  const managerId = market.managerIdByTeamId.get(id) ?? null;

  const summary = managerId === null ? null : marketSummary(market.operations, managerId);
  const playerName = (playerId: string) => market.playerNames.get(playerId);

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

      <h2 className="mt-10 text-[11px] uppercase tracking-[0.06em]" style={{ color: "var(--board-ink-dim)" }}>
        Their market
      </h2>
      {summary === null ? null : (
        <>
          <MarketMoney summary={summary} nameOf={playerName} />
          {/* The one caveat every figure above shares. The activity feed is a rolling
              seven-day window, so the log reaches back only as far as the first sweep
              walked it — every total here is "since then", not "this season". Said once
              under the table rather than in four captions. */}
          <p className="mt-2 text-[10.5px]" style={{ color: "var(--board-ink-dim)" }}>
            Since the market log begins. A clause is money moved, not a sale: being
            charged for a player somebody took is counted apart from selling one.
          </p>
        </>
      )}
      {managerId === null ? (
        // The team exists — it was found in `teams` above — but the market has no
        // manager id for it, which means no sweep has read the market yet.
        <p className="mt-6 text-[13px]" style={{ color: "var(--board-ink-dim)" }}>
          Nothing in the market log yet.
        </p>
      ) : (
        <MarketFeed
          operations={market.operations}
          managerNames={market.managerNames}
          playerNames={market.playerNames}
        teamIdByManagerId={market.teamIdByManagerId}
          focus={{ managerId }}
        />
      )}
    </section>
  );
}
