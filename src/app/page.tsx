import Link from "next/link";
import { db } from "@/lib/db";
import { loadSnapshots } from "@/lib/db/queries";
import { buildRoundTable, buildTable, recentForm } from "@/lib/domain/standings";
import { breakfastDuties, dutyFor, projectedDuty } from "@/lib/domain/breakfast";
import { formatMoney } from "@/lib/domain/players";
import { getSession } from "@/lib/auth/guards";
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
import { StandingsTable } from "@/components/standings-table";
import { RoundTable } from "@/components/round-table";
import { BreakfastLine } from "@/components/breakfast-line";

/** The page's section rule: one dim line, the same one the tables' own headers use. */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="mt-6 text-[11px] uppercase tracking-[0.06em]"
      style={{ color: "var(--board-ink-dim)" }}
    >
      {children}
    </h2>
  );
}

/** The link under a table: where to go for the rounds this page does not show. */
function MoreLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="mt-3 inline-block border-b pb-0.5 text-[11.5px]"
      style={{ borderColor: "var(--board-line)", color: "var(--board-ink-dim)" }}
    >
      {label} →
    </Link>
  );
}

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

  const myTeam = await loadMyTeam(db, { userId: session.user.id });

  // Cheap next to the catalogue read this page used to run for its two player boards:
  // thirteen teams times the weeks played, which is sixty-five rows today and under five
  // hundred by May. Nothing here reads `/players` any more.
  const { snapshots, teams: teamRefs, activeTeams, isLive, currentGameweek } =
    await loadSnapshots(db);
  // The season table is the league as it is now, so a manager who has left is not in it.
  // Everything else on this page reads the full list: a past record still names them.
  const rows = buildTable(snapshots, activeTeams);
  const mine = myTeam ? rows.find((row) => row.teamId === myTeam.teamId) : undefined;

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

  // The round the page shows: the last one with snapshots, which is the one being played
  // whenever one is. Taken from the snapshots and not from `currentGameweek`, because the
  // player sweep can write a gameweek the standings have no rows for yet.
  const played = [...new Set(snapshots.map((s) => s.gameweek))].sort((a, b) => a - b);
  const round = played.at(-1) ?? null;
  // Only when the live week is the one on screen: `isLive` speaks for the newest gameweek
  // row, which may be one the standings have not reached.
  const inPlay = isLive && currentGameweek === round;
  const duties = breakfastDuties(snapshots);
  // Computed once so the sentence above the table and the marks on its rows are the same
  // duty said two ways, and never disagree with each other.
  // A round still being played has no settled duty, so it falls through to the projection:
  // its shields, which the finished rounds decided, and the bringer as the points stand.
  const roundDuty =
    round === null ? null : (dutyFor(duties, round) ?? projectedDuty(snapshots, duties, round));
  const names = new Map(teamRefs.map((team) => [team.id, team.managerName]));

  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold">TebasFury</h1>
      <p className="mt-2" style={{ color: "var(--board-ink-dim)" }}>
        Management portal for our private LaLiga Fantasy league.
      </p>

      <ClaimLine myTeamName={myTeam?.managerName ?? null} myTeamId={myTeam?.teamId ?? null} />

      <KpiStrip items={kpis} />

      <SectionHeading>League</SectionHeading>
      <MetricGrid items={leagueItems} />

      {rows.length === 0 ? (
        <p className="mt-6" style={{ color: "var(--board-ink-dim)" }}>
          Nothing has synced yet. An admin can run the first sync from the Sync page.
        </p>
      ) : (
        <>
          {/* Teams and gameweek stats are written in two separate, non-transactional
              passes (`runSync`), so a real gap exists where the teams are known and no
              round is: the table below still has its rows, and there is no round to show
              above it. */}
          {round === null ? null : (
            <>
              <SectionHeading>Round {round}{inPlay ? " · in play" : ""}</SectionHeading>
              <BreakfastLine duty={roundDuty} gameweek={round} names={names} />
              <RoundTable
                rows={buildRoundTable(snapshots, teamRefs, round)}
                gameweek={round}
                myTeamId={myTeam?.teamId ?? null}
                duty={roundDuty}
              />
              <MoreLink href={`/standings?round=${round}`} label="Every other round" />
            </>
          )}

          <SectionHeading>Standings</SectionHeading>
          <StandingsTable
            rows={rows}
            formByTeam={recentForm(snapshots, activeTeams)}
            isLive={isLive}
            myTeamId={myTeam?.teamId ?? null}
          />
          <MoreLink href="/standings" label="Standings, round by round" />
        </>
      )}
    </section>
  );
}
