import { db } from "@/lib/db";
import { loadPlayerCatalogue } from "@/lib/db/queries";
import { buildCatalogue, parseCatalogueEntry } from "@/lib/domain/players";
import { requireSession } from "@/lib/auth/guards";
import { PlayerCatalogue } from "@/components/player-catalogue";

export default async function PlayersPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireSession();
  const entry = parseCatalogueEntry(await searchParams);
  const { players, totals, values, ownership, clubs, ownershipKnown, lastSweep } =
    await loadPlayerCatalogue(db);
  const rows = buildCatalogue({ players, totals, values, ownership, clubs });

  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="text-xl font-medium">Players</h1>
      <p className="mt-1 text-[13px]" style={{ color: "var(--board-ink-dim)" }}>
        Every eligible player, what they cost and what they score.
      </p>

      <PlayerCatalogue
        rows={rows}
        ownershipKnown={ownershipKnown}
        initialSort={entry.sort}
        initialOwnership={entry.ownership}
      />

      <p className="mt-6 text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
        {lastSweep ? `Last swept ${lastSweep.toISOString()}` : "Never swept"}
      </p>
    </section>
  );
}
