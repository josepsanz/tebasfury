import { db } from "@/lib/db";
import { loadSnapshots } from "@/lib/db/queries";
import { buildRoundTable, buildTable, recentForm } from "@/lib/domain/standings";
import { breakfastDuties, dutyFor, projectedDuty } from "@/lib/domain/breakfast";
import { requireSession } from "@/lib/auth/guards";
import { StandingsTable } from "@/components/standings-table";
import { RoundTable } from "@/components/round-table";
import { RoundPicker } from "@/components/round-picker";
import { PageHeader } from "@/components/page-header";
import { BreakfastLine } from "@/components/breakfast-line";
import { loadMyTeam } from "@/lib/claims";

/**
 * Which round the URL is asking for, or null for the season.
 *
 * A parameter that is not a number, or names a round nothing was recorded for, falls back
 * to the season rather than erroring: a hand-edited URL is not an exceptional condition,
 * and a 404 for `?round=99` would be a worse answer than the table the reader came for.
 */
function chosenRound(raw: string | string[] | undefined, played: number[]): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) return null;
  const round = Number(value);
  return Number.isInteger(round) && played.includes(round) ? round : null;
}

export default async function StandingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await requireSession();
  const { snapshots, teams, isLive } = await loadSnapshots(db);
  const myTeam = await loadMyTeam(db, { userId: session.user.id });

  const played = [...new Set(snapshots.map((s) => s.gameweek))].sort((a, b) => a - b);
  const round = chosenRound((await searchParams).round, played);

  const rows = buildTable(snapshots, teams);

  const duties = breakfastDuties(snapshots);
  const names = new Map(teams.map((team) => [team.id, team.managerName]));
  // The season view answers the question the league actually asks on a Monday — who is
  // bringing it — for the most recent round that has one. The round view answers it for the
  // round being read.
  const latest = duties.at(-1) ?? null;
  // Teams and gameweek stats are written in two separate, non-transactional passes
  // (`runSync`), so a real gap exists where teams are synced but no gameweek is: `rows`
  // is non-empty, but `played` — and so `duties` — is empty. There is no round to name
  // in that gap, and "Round 0" would be an invented one, so `null` here means "show
  // nothing" rather than a fallback number for `BreakfastLine` to turn into a sentence.
  const seasonBreakfastGameweek = latest?.gameweek ?? (played.length > 0 ? played[played.length - 1] : null);
  // Computed once so the sentence above the round table and the marks on its rows are the
  // same duty said two ways, and never disagree with each other.
  // As on the home page: a round still being played falls through to the projection. The
  // season sentence above reads `duties` and so stays settled — `latest` is never a guess.
  const roundDuty =
    round !== null ? (dutyFor(duties, round) ?? projectedDuty(snapshots, duties, round)) : null;

  return (
    <section className="mx-auto max-w-2xl">
      <PageHeader title="Standings" meta={`${rows.length} teams`} />

      {rows.length === 0 ? (
        <p className="mt-6" style={{ color: "var(--board-ink-dim)" }}>
          Nothing has synced yet. An admin can run the first sync from the Sync page.
        </p>
      ) : (
        <>
          <div className="mt-4">
            <RoundPicker gameweeks={played} selected={round} />
          </div>

          {round === null ? (
            <>
              {seasonBreakfastGameweek !== null ? (
                <BreakfastLine duty={latest} gameweek={seasonBreakfastGameweek} names={names} />
              ) : null}
              <StandingsTable
                rows={rows}
                formByTeam={recentForm(snapshots, teams)}
                isLive={isLive}
                myTeamId={myTeam?.teamId ?? null}
              />
            </>
          ) : (
            <>
              <BreakfastLine duty={roundDuty} gameweek={round} names={names} />
              <RoundTable
                rows={buildRoundTable(snapshots, teams, round)}
                gameweek={round}
                myTeamId={myTeam?.teamId ?? null}
                duty={roundDuty}
              />
            </>
          )}
        </>
      )}
    </section>
  );
}
