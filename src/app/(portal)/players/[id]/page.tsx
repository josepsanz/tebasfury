import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { loadPlayer } from "@/lib/db/queries";
import { formatMoney, pointsSeries, statusLabel, valueSeries } from "@/lib/domain/players";
import { requireSession } from "@/lib/auth/guards";
import { PlayerCharts } from "@/components/player-charts";

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  // The guard runs before the lookup: an anonymous visitor must not be able to tell an
  // existing player id from a missing one by the difference between a redirect and a 404.
  await requireSession();
  const { id } = await params;
  const detail = await loadPlayer(db, id);
  if (detail === null) notFound();

  const { player, owner, lastSweep } = detail;
  const values = valueSeries(detail.values);
  const points = pointsSeries(detail.points);
  const seasonPoints = detail.points.reduce((sum, p) => sum + p.points, 0);
  const currentValue = values.at(-1)?.value ?? null;
  const label = statusLabel(player.status);

  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="text-xl font-medium">{player.nickname}</h1>
      <p className="mt-1 text-[13px]" style={{ color: "var(--board-ink-dim)" }}>
        {player.position} ·{" "}
        {owner === null ? (
          <span style={{ color: "var(--board-free)" }}>Free agent</span>
        ) : (
          owner.managerName
        )}
        {label === null ? null : <span style={{ color: "var(--board-alert)" }}> · {label}</span>}
      </p>

      <div className="mt-6 flex gap-10">
        <span>
          <span
            className="block text-[27px] font-extralight leading-none tabular-nums"
            style={{ fontFamily: "var(--font-barlow-condensed)" }}
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
            style={{ fontFamily: "var(--font-barlow-condensed)" }}
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

      <p className="mt-10 text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
        {lastSweep ? `Last swept ${lastSweep.toISOString()}` : "Never swept"}
      </p>
    </section>
  );
}
