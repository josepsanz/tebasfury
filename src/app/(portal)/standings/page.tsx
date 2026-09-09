import { db } from "@/lib/db";
import { loadSnapshots } from "@/lib/db/queries";
import { buildTable } from "@/lib/domain/standings";
import { requireSession } from "@/lib/auth/guards";
import { StandingsTable } from "@/components/standings-table";
import { PageHeader } from "@/components/page-header";
import { loadMyTeam } from "@/lib/claims";

export default async function StandingsPage() {
  const session = await requireSession();
  const { snapshots, teams, isLive } = await loadSnapshots(db);
  const rows = buildTable(snapshots, teams);
  const myTeam = await loadMyTeam(db, { userId: session.user.id });

  const formByTeam: Record<string, number[]> = {};
  const weeks = [...new Set(snapshots.map((s) => s.gameweek))].sort((a, b) => a - b).slice(-3);
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
        <StandingsTable
          rows={rows}
          formByTeam={formByTeam}
          isLive={isLive}
          myTeamId={myTeam?.teamId ?? null}
        />
      )}

    </section>
  );
}
