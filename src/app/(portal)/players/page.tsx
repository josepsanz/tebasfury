import { db } from "@/lib/db";
import { loadPlayerCatalogue } from "@/lib/db/queries";
import { buildCatalogue } from "@/lib/domain/players";
import { clauseStatus, type ClauseStatus } from "@/lib/domain/market";
import { requireSession } from "@/lib/auth/guards";
import { PlayerCatalogue } from "@/components/player-catalogue";
import { PageHeader } from "@/components/page-header";
import { formatSyncedAt } from "@/lib/domain/clock";

// The catalogue's filters are read from the address by the catalogue itself, so this page
// takes no `searchParams`: one reader of them, and it is the component that has to follow
// them on a back navigation.
export default async function PlayersPage() {
  await requireSession();
  const { players, totals, values, ownership, clubs, ownershipKnown, lastSweep } =
    await loadPlayerCatalogue(db);
  const rows = buildCatalogue({ players, totals, values, ownership, clubs });

  // Every owned player's clause state, worked out once here rather than per row in the
  // browser: the catalogue re-renders on every keystroke of the search box, and the
  // league's timezone belongs on one server render rather than eight hundred client ones.
  const now = new Date();
  const clauses: Record<string, ClauseStatus> = {};
  for (const row of rows) {
    if (row.ownerTeamId === null) continue;
    clauses[row.id] = clauseStatus(
      { lockedUntil: row.clauseLockedUntil, shielded: row.shielded },
      now,
    );
  }


  return (
    <section className="mx-auto max-w-2xl">
      <PageHeader
        title="Players"
        note="Every eligible player, what they cost and what they score."
        meta={`${rows.length} players`}
      />

      <PlayerCatalogue
        rows={rows}
        ownershipKnown={ownershipKnown}
        clauses={clauses}
        now={now}
      />

      <p className="mt-6 text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
        {/* The sweep is its own cadence, daily and separate from the standings chain the
            status strip reports, so this line is not a duplicate of it. */}
        {lastSweep ? `Last swept ${formatSyncedAt(lastSweep, new Date())}` : "Never swept"}
      </p>
    </section>
  );
}
