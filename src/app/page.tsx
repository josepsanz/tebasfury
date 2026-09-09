import { db } from "@/lib/db";
import { loadPlayerCatalogue, loadSnapshots } from "@/lib/db/queries";
import { buildTable } from "@/lib/domain/standings";
import {
  bestValueForMoney,
  buildCatalogue,
  formatMoney,
  freeAndScoring,
  pointsPerMillion,
} from "@/lib/domain/players";
import { getSession } from "@/lib/auth/guards";
import { OpportunityBoard } from "@/components/opportunity-board";
import { loadMyTeam } from "@/lib/claims";
import { ClaimLine } from "@/components/claim-line";
import { KpiStrip, type Kpi } from "@/components/kpi-strip";
import { leagueMetrics } from "@/lib/domain/metrics";
import {
  formatAverage,
  formatRecord,
  formatTrend,
  formatWorstRecord,
} from "@/lib/domain/metric-copy";
import { MetricGrid, type Metric } from "@/components/metric-grid";

export default async function HomePage() {
  const session = await getSession();

  // `getSession`, not `requireSession`: an anonymous visitor keeps the page they have
  // today rather than being redirected to /login, which would be a behaviour change
  // nobody asked for. Same conditional pattern `AppNav` already uses.
  if (!session) {
    return (
      <section className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-semibold">TebasFury</h1>
        <p className="mt-2" style={{ color: "var(--board-ink-dim)" }}>
          Management portal for our private LaLiga Fantasy league.
        </p>
      </section>
    );
  }

  // The same read `/players` runs, and no other. Ruling 7 names the cost: 840 players
  // and their aggregates for ten rows, in exchange for one place where the ranking
  // rules live and nothing crossing to the client.
  const { players, totals, values, ownership, clubs, ownershipKnown } =
    await loadPlayerCatalogue(db);
  const rows = buildCatalogue({ players, totals, values, ownership, clubs });
  const myTeam = await loadMyTeam(db, { userId: session.user.id });

  // Cheap next to the catalogue read above: thirteen teams times the weeks played, which
  // is sixty-five rows today and under five hundred by May.
  const { snapshots, teams: teamRefs, isLive } = await loadSnapshots(db);
  const mine = myTeam
    ? buildTable(snapshots, teamRefs).find((row) => row.teamId === myTeam.teamId)
    : undefined;

  // Only for a manager who has claimed a team: without one there is no "your rank" to
  // report, and inventing a league-wide figure here would answer a question nobody asked.
  const kpis: Kpi[] = mine
    ? [
        {
          label: "Your rank",
          value: String(mine.position),
          delta:
            mine.previousPosition === null || mine.previousPosition === mine.position
              ? undefined
              : {
                  text: String(Math.abs(mine.previousPosition - mine.position)),
                  rising: mine.previousPosition > mine.position,
                },
        },
        { label: "Total points", value: String(mine.cumulativePoints) },
        ...(isLive && mine.livePoints !== null
          ? [{ label: "Live points", value: String(mine.livePoints) }]
          : mine.teamValue !== null
            ? [{ label: "Squad value", value: formatMoney(mine.teamValue) }]
            : []),
      ]
    : [];

  const league = leagueMetrics(snapshots);
  const nameOf = (teamId: string) =>
    teamRefs.find((team) => team.id === teamId)?.managerName ?? teamId;

  const leagueItems: Metric[] = [
    { label: "League average", ...formatAverage(league.average) },
    { label: "League trend", ...formatTrend(league.trend) },
    { label: "Best round", ...formatRecord(league.best, nameOf) },
    { label: "Worst round", ...formatWorstRecord(league.worst, nameOf) },
  ];

  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold">TebasFury</h1>
      <p className="mt-2" style={{ color: "var(--board-ink-dim)" }}>
        Management portal for our private LaLiga Fantasy league.
      </p>

      <ClaimLine myTeamName={myTeam?.managerName ?? null} />

      <KpiStrip items={kpis} />

      <h2
        className="mt-6 text-[11px] uppercase tracking-[0.06em]"
        style={{ color: "var(--board-ink-dim)" }}
      >
        League
      </h2>
      <MetricGrid items={leagueItems} />

      <OpportunityBoard
        title="Best value for money"
        note="Points per million of market value. Players with at least three recorded gameweeks, the same floor the catalogue's “Best average” uses."
        rows={bestValueForMoney(rows)}
        emptyNote="No player has three recorded gameweeks yet. This fills in as the season goes."
        figure={(row) => ({
          // `pointsPerMillion`, never the division written out again: the rule lives in
          // one place, which is the whole reason Ruling 7 refused a SQL ranking. The
          // fallback is unreachable — a positive, non-null result is what
          // `bestValueForMoney` filters on — and is here to satisfy the type, not to
          // paper over a case.
          value: (pointsPerMillion(row.seasonPoints, row.currentValue) ?? 0).toFixed(1),
          unit: `pts/M€ · ${row.currentValue === null ? "—" : formatMoney(row.currentValue)}`,
        })}
        // Omitted, not pointed at an empty catalogue: before the first sweep `rows` is
        // empty and "All 0 by value for money" would send a reader to a catalogue that
        // says nothing has been swept yet. A board that is empty while the catalogue
        // has players keeps its link — that is the case this guard leaves alone.
        link={
          rows.length === 0
            ? undefined
            : { href: "/players?sort=perMillion", label: `All ${rows.length} by value for money` }
        }
        ownershipKnown={ownershipKnown}
      />

      <OpportunityBoard
        title="Free and scoring"
        note="Nobody in the league owns them. Ranked by season points."
        rows={freeAndScoring(rows)}
        emptyNote="No unowned player has scored yet."
        figure={(row) => ({
          value: String(row.seasonPoints),
          unit: `pts · ${row.currentValue === null ? "—" : formatMoney(row.currentValue)}`,
        })}
        link={
          rows.length === 0
            ? undefined
            : { href: "/players?ownership=free&sort=points", label: "All free agents" }
        }
        ownershipKnown={ownershipKnown}
        unknownOwnershipNote="No squad has been read yet, so nobody can be called free. The next sweep settles it."
      />
    </section>
  );
}
