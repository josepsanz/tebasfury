import Image from "next/image";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { loadMarket, loadPlayer } from "@/lib/db/queries";
import { formatMoney, pointsSeries, statusLabel, valueSeries } from "@/lib/domain/players";
import { clauseStatus } from "@/lib/domain/market";
import { requireSession } from "@/lib/auth/guards";
import { PlayerCharts } from "@/components/player-charts";
import { OwnerLabel } from "@/components/owner-label";
import { ClauseNote } from "@/components/clause-marks";
import { LockIcon } from "@/components/lock-icon";
import { ShieldIcon } from "@/components/shield-icon";
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
  // Only an owned player has a clause: there is nothing to take a free agent from.
  const clause =
    owner === null
      ? undefined
      : clauseStatus(
          { lockedUntil: owner.clauseLockedUntil, shielded: owner.shielded },
          new Date(),
        );

  return (
    <section className="mx-auto max-w-2xl">
      <div className="flex items-center gap-3">
        {/* An ID badge, not a hero shot. The portal is a trading board — a full-bleed
            photograph would be the loudest thing on a page whose subject is two charts —
            so the portrait is sized like the figures beside it and framed in the same
            hairline every panel here uses.

            `alt=""` on purpose: the name is the very next thing in the reading order, and
            an image announced as "Ada" beside a heading that says Ada is the same fact
            twice. Empty alt is what marks it decorative rather than unlabelled. */}
        {player.imageUrl === null ? null : (
          <span
            className="block shrink-0 overflow-hidden border"
            style={{ borderColor: "var(--board-line)", background: "var(--board-panel)" }}
          >
            <Image
              src={player.imageUrl}
              alt=""
              width={64}
              height={64}
              // The source is 256×256. At 64 CSS pixels the optimizer is asked for a
              // 128-wide variant as well, for retina — still half the original, so it
              // never upscales, and it arrives around 5KB instead of 64.
              className="block h-16 w-16 object-cover"
            />
          </span>
        )}

        <span className="min-w-0">
          {/* The marks, but NOT the colour the catalogue and the squad put on a name.
              Those are lists, scanned; this is one player's page, and its heading in
              `--board-ink-dim` would read as disabled rather than as locked. The state
              still arrives in the same words, in the line below, and in the same two
              shapes — only the hue is spent differently here. */}
          <h1 className="flex items-baseline gap-2 text-xl font-medium">
            <span className="min-w-0 truncate">{player.nickname}</span>
            {clause?.state === "locked" ? (
              <span className="shrink-0" title={clause.label}>
                <LockIcon size={12} />
              </span>
            ) : null}
            {clause?.shielded ? (
              <span className="shrink-0" title="Shielded">
                <ShieldIcon size={13} />
              </span>
            ) : null}
          </h1>
          <p className="mt-1 text-[13px]" style={{ color: "var(--board-ink-dim)" }}>
            {player.position}
            {detail.club === null ? "" : ` · ${detail.club.name}`} ·{" "}
            {/* Same three-state logic as the catalogue row, via the shared component:
                "Free agent" is a claim the page can only make once at least one squad has
                been read, not merely from the absence of an owner row. */}
            <OwnerLabel ownerName={owner?.managerName ?? null} ownershipKnown={ownershipKnown} />
            <ClauseNote clause={clause} />
            {label === null ? null : (
              <span style={{ color: "var(--board-alert)" }}> · {label}</span>
            )}
          </p>
        </span>
      </div>

      {/* Points first: what the player has actually done. Then what they are worth, then
          what it would cost to take them — the last only when somebody holds them, since
          a free agent has no clause to pay. Wrapping rather than three figures crushed
          together at 320px. */}
      <div className="mt-6 flex flex-wrap gap-x-10 gap-y-4">
        <Figure label="points this season" value={String(seasonPoints)} />
        <Figure
          label="market value"
          value={currentValue === null ? "—" : formatMoney(currentValue)}
        />
        {owner?.buyoutClause == null ? null : (
          <Figure label="buyout clause" value={formatMoney(owner.buyoutClause)} />
        )}
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
        teamIdByManagerId={market.teamIdByManagerId}
        focus={{ playerId: player.id }}
      />

      <p className="mt-10 text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
        {lastSweep ? `Last swept ${lastSweep.toISOString()}` : "Never swept"}
      </p>
    </section>
  );
}

/**
 * One of the page's headline figures.
 *
 * Three of them now, and they were two copies of the same twelve lines before the clause
 * joined them — a third copy is where the type scale starts drifting.
 */
function Figure({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span
        className="block text-[27px] font-extralight leading-none tabular-nums"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {value}
      </span>
      <span className="block text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
        {label}
      </span>
    </span>
  );
}
