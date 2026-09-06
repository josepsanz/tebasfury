import { db } from "@/lib/db";
import { loadSnapshots } from "@/lib/db/queries";
import { buildTable } from "@/lib/domain/standings";
import { requireSession } from "@/lib/auth/guards";
import { StandingsTable } from "@/components/standings-table";

export default async function StandingsPage() {
  await requireSession();
  const { snapshots, teams, lastSync, currentGameweek, isLive } = await loadSnapshots(db);
  const rows = buildTable(snapshots, teams);

  const formByTeam: Record<string, number[]> = {};
  const weeks = [...new Set(snapshots.map((s) => s.gameweek))].sort((a, b) => a - b).slice(-3);
  for (const team of teams) {
    formByTeam[team.id] = weeks.map(
      (w) => snapshots.find((s) => s.teamId === team.id && s.gameweek === w)?.points ?? 0,
    );
  }

  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="text-xl font-medium">Standings</h1>
      <p className="mt-1 text-[11.5px] tracking-[0.1em]" style={{ color: "var(--board-ink-dim)" }}>
        {currentGameweek === null
          ? "NO GAMEWEEK SYNCED YET"
          : isLive
            ? `GAMEWEEK ${currentGameweek} · IN PLAY`
            : `GAMEWEEK ${currentGameweek} · FINAL`}
      </p>

      {rows.length === 0 ? (
        <p className="mt-6" style={{ color: "var(--board-ink-dim)" }}>
          Nothing has synced yet. An admin can run the first sync from the Sync page.
        </p>
      ) : (
        <StandingsTable rows={rows} formByTeam={formByTeam} isLive={isLive} />
      )}

      <p className="mt-6 text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
        {lastSync ? `Last synced ${lastSync.toISOString()}` : "Never synced"}
      </p>
    </section>
  );
}
