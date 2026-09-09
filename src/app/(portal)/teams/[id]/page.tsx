import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { loadMarket, loadPlayerCatalogue, loadSnapshots } from "@/lib/db/queries";
import { teamMetrics } from "@/lib/domain/metrics";
import {
  clauseStatus,
  fairPlayHold,
  marketSummary,
  type ClauseStatus,
} from "@/lib/domain/market";
import { buildCatalogue, squadByPosition, squadValue } from "@/lib/domain/players";
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
import { SquadList } from "@/components/squad-list";
import { PitchIcon } from "@/components/pitch-icon";
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

  // The catalogue, filtered — not a query of its own. Ownership is already joined there,
  // and it carries each player's value and points, which `squad_members` does not.
  const catalogue = await loadPlayerCatalogue(db);
  const squad = squadByPosition(buildCatalogue(catalogue), id);

  // Whether each of their players can be taken, read from the row rather than worked out:
  // the sweep stores what the API states, so nothing here depends on the market log having
  // witnessed the purchase. Worked out once on the server, like the catalogue's, so the
  // league's timezone lands in one render.
  const now = new Date();
  const clauses: Record<string, ClauseStatus> = {};
  // Who their owner cannot sell yet — the other half of the same purchase, and asked only
  // here. The catalogue wants to know who can be taken; a squad is also read by the person
  // deciding what to move on.
  const holds: Record<string, Date> = {};
  for (const group of squad) {
    for (const player of group.players) {
      clauses[player.id] = clauseStatus(
        { lockedUntil: player.clauseLockedUntil, shielded: player.shielded },
        now,
      );
      const hold = fairPlayHold(player.clauseLockedUntil, now);
      if (hold !== null) holds[player.id] = hold;
    }
  }

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

      <h2
        className="mt-10 flex items-baseline justify-between gap-3 text-[11px] uppercase tracking-[0.06em]"
        style={{ color: "var(--board-ink-dim)" }}
      >
        Their squad
        {/* The only way in to the lineup page. It belongs beside the squad because the
            two answer neighbouring questions — what they hold, and what they could field
            with it — and the nav bar is already at its width at 375px. */}
        {/* An icon, so the label's job moves to `aria-label` — without it the control
            would announce as "link" and nothing else. `title` gives the same words to a
            sighted reader on hover, since a pitch pictogram is only obvious once you have
            been told. The border and the padding are the touch target: a 20px icon is
            about half what a thumb needs, and this codebase has already had to fix one
            link that was hard to hit. */}
        <Link
          href={`/teams/${id}/lineup`}
          aria-label="Best lineup"
          title="Best lineup"
          className="-my-1 flex items-center border px-2 py-1 transition-colors"
          style={{ borderColor: "var(--board-line)" }}
        >
          <PitchIcon />
        </Link>
      </h2>
      {/* What they hold now. The market log below is how it got that way — two different
          questions, and neither derivable from the other: the log reaches back only to the
          first sweep, and a squad has players who arrived before that. */}
      <SquadList
        groups={squad}
        total={squadValue(squad)}
        ownershipKnown={catalogue.ownershipKnown}
        clauses={clauses}
        holds={holds}
      />

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
