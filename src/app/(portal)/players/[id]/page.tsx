import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { loadMarket, loadPlayer } from "@/lib/db/queries";
import { formatMoney, pointsSeries, statusLabel, valueSeries } from "@/lib/domain/players";
import { requireSession } from "@/lib/auth/guards";
import { PlayerCharts } from "@/components/player-charts";
import { OwnerLabel } from "@/components/owner-label";
import { MarketFeed } from "@/components/market-feed";

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  // The guard runs before the lookup: an anonymous visitor must not be able to tell an
  // existing player id from a missing one by the difference between a redirect and a 404.
  await requireSession();
  const { id } = await params;
  const detail = await loadPlayer(db, id);
  if (detail === null) notFound();

  // The WHOLE market, deliberately, then filtered inside the feed. This player's own
  // rows are not enough to date a sale: the purchase that starts the holding is in the
  // same list but not in the filtered slice, and filtering first would report a broken
  // rule as unknowable.
  const market = await loadMarket(db);

  const { player, owner, ownershipKnown, lastSweep } = detail;
  const values = valueSeries(detail.values);
  // The season's furthest gameweek, not this player's: two players' charts have to be
  // drawn against the same axis to be worth putting on the same screen.
  const points = pointsSeries(detail.points, detail.seasonLastGameweek ?? undefined);
  const seasonPoints = detail.points.reduce((sum, p) => sum + p.points, 0);
  const currentValue = values.at(-1)?.value ?? null;
  const label = statusLabel(player.status);

  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="text-xl font-medium">{player.nickname}</h1>
      <p className="mt-1 text-[13px]" style={{ color: "var(--board-ink-dim)" }}>
        {player.position}
        {detail.club === null ? "" : ` · ${detail.club.name}`} ·{" "}
        {/* Same three-state logic as the catalogue row, via the shared component:
            "Free agent" is a claim the page can only make once at least one squad has
            been read, not merely from the absence of an owner row. */}
        <OwnerLabel ownerName={owner?.managerName ?? null} ownershipKnown={ownershipKnown} />
        {label === null ? null : <span style={{ color: "var(--board-alert)" }}> · {label}</span>}
      </p>

      <div className="mt-6 flex gap-10">
        <span>
          <span
            className="block text-[27px] font-extralight leading-none tabular-nums"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {currentValue === null ? "—" : formatMoney(currentValue)}
          </span>
          <span className="block text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
            market value
          </span>
        </span>
        <span>
          <span
            className="block text-[27px] font-extralight leading-none tabular-nums"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {seasonPoints}
          </span>
          <span className="block text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
            points this season
          </span>
        </span>
      </div>

      <div className="mt-10">
        <PlayerCharts points={points} values={values} />
      </div>

      <h2 className="mt-10 text-[11px] uppercase tracking-[0.06em]" style={{ color: "var(--board-ink-dim)" }}>
        Through these hands
      </h2>
      <MarketFeed
        operations={market.operations}
        managerNames={market.managerNames}
        playerNames={market.playerNames}
        focus={{ playerId: player.id }}
      />

      <p className="mt-10 text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
        {lastSweep ? `Last swept ${lastSweep.toISOString()}` : "Never swept"}
      </p>
    </section>
  );
}
