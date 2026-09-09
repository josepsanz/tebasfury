import { db } from "@/lib/db";
import { loadSnapshots } from "@/lib/db/queries";
import { buildRoundTable, buildTable } from "@/lib/domain/standings";
import { requireSession } from "@/lib/auth/guards";
import { StandingsTable } from "@/components/standings-table";
import { RoundTable } from "@/components/round-table";
import { RoundPicker } from "@/components/round-picker";
import { PageHeader } from "@/components/page-header";
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

  const formByTeam: Record<string, number[]> = {};
  const weeks = played.slice(-3);
  for (const team of teams) {
    formByTeam[team.id] = weeks.map(
      (w) => snapshots.find((s) => s.teamId === team.id && s.gameweek === w)?.points ?? 0,
    );
  }

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
            <StandingsTable
              rows={rows}
              formByTeam={formByTeam}
              isLive={isLive}
              myTeamId={myTeam?.teamId ?? null}
            />
          ) : (
            <RoundTable
              rows={buildRoundTable(snapshots, teams, round)}
              gameweek={round}
              myTeamId={myTeam?.teamId ?? null}
            />
          )}
        </>
      )}
    </section>
  );
}
