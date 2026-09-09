import { db } from "@/lib/db";
import { loadMarket, loadPlayerCatalogue } from "@/lib/db/queries";
import { requireSession } from "@/lib/auth/guards";
import { clauseBoard } from "@/lib/domain/market";
import { buildCatalogue } from "@/lib/domain/players";
import { MarketFeed } from "@/components/market-feed";
import { ClauseBoard } from "@/components/clause-board";
import { PageHeader } from "@/components/page-header";

export default async function MarketPage() {
  await requireSession();
  const { operations, managerNames, playerNames, teamIdByManagerId, logBegan } =
    await loadMarket(db);

  // The catalogue, for who currently holds whom and what they are worth — the clause board
  // needs both, and `market_operations` carries neither. Same read `/players` and
  // `/teams/[id]` already make; no narrower path exists and a second one would be a second
  // thing to keep correct.
  const catalogue = await loadPlayerCatalogue(db);
  const rows = buildCatalogue(catalogue);
  const now = new Date();

  const held = rows.filter((row) => row.ownerTeamId !== null);
  const managerIdOf = new Map(
    [...teamIdByManagerId].map(([managerId, teamId]) => [teamId, managerId]),
  );
  const board = clauseBoard(
    operations,
    held.flatMap((row) => {
      const managerId = managerIdOf.get(row.ownerTeamId as string);
      // A held player whose team the standings have never named cannot be attributed to a
      // manager, so they are left off rather than shown against nobody.
      return managerId === undefined ? [] : [{ playerId: row.id, managerId }];
    }),
    now,
  );

  const owners = new Map(
    [...teamIdByManagerId].map(([managerId, teamId]) => [
      managerId,
      { teamId, name: managerNames.get(managerId) ?? String(managerId) },
    ]),
  );

  return (
    <section className="mx-auto max-w-2xl">
      <PageHeader
        title="Market"
        note="Players are not sold before five days. Sales inside that window are marked."
        meta={`${operations.length} operations`}
      />

      <h2 className="mt-8 text-[11px] uppercase tracking-[0.06em]" style={{ color: "var(--board-ink-dim)" }}>
        Clause protection
      </h2>
      <p className="mt-1 text-[12px]" style={{ color: "var(--board-ink-dim)" }}>
        A bought player cannot be taken by clause for fifteen days. Their owner may still
        sell by agreement — the lock stops a raid, not a trade.
      </p>
      <ClauseBoard
        board={board}
        players={new Map(rows.map((row) => [row.id, row]))}
        owners={owners}
        now={now}
        logBegan={logBegan}
      />

      <h2 className="mt-10 text-[11px] uppercase tracking-[0.06em]" style={{ color: "var(--board-ink-dim)" }}>
        Every operation
      </h2>
      <MarketFeed operations={operations} managerNames={managerNames} playerNames={playerNames}
        teamIdByManagerId={teamIdByManagerId} />

      <p className="mt-6 text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
        {logBegan === null
          ? "Nothing captured yet."
          : `This log reaches back to ${logBegan.toISOString().slice(0, 10)}, which is as far as the API will go. Anything before that is unknowable rather than clean.`}
      </p>
    </section>
  );
}
