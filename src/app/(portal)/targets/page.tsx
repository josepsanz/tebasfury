import { db } from "@/lib/db";
import { loadTargets } from "@/lib/db/queries";
import { loadMyTeam } from "@/lib/claims";
import { requireSession } from "@/lib/auth/guards";
import { buildTargets, isMarketStale, parseTargetView, rankTargets } from "@/lib/domain/targets";
import { formatLeagueMoment, formatSyncedAt } from "@/lib/domain/clock";
import { PageHeader } from "@/components/page-header";
import { TargetControls } from "@/components/target-controls";
import { LockedTargets, TargetList } from "@/components/target-list";

const POSITIONS = ["Goalkeeper", "Defender", "Midfielder", "Forward", "Coach"];

/**
 * Everyone the reader could buy today, ranked through one of two lenses.
 *
 * The view lives in the address (`searchParams` is a Promise in this Next), so a ranking
 * can be linked. The page loads every candidate once and does the filtering in the domain
 * module; it owns only the sentence about how old the market read is, because a ranking of
 * yesterday's auctions must say so.
 */
export default async function TargetsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await requireSession();
  const [{ inputs, marketReadAt, auctionClosesAt }, myTeam] = await Promise.all([
    loadTargets(db),
    loadMyTeam(db, { userId: session.user.id }),
  ]);
  const now = new Date();
  const view = parseTargetView(await searchParams);
  const board = buildTargets(inputs, { now, readerTeamId: myTeam?.teamId ?? null });
  const rows = rankTargets(board.ranked, view);
  const stale = isMarketStale(marketReadAt, now);

  return (
    <section className="mx-auto max-w-2xl">
      <PageHeader
        title="Targets"
        note="Everyone you could buy today, ranked by what they would return or score for what they would really cost."
        meta={`${rows.length} targets`}
      />

      <p className="mt-2 text-[11px]" style={{ color: stale ? "var(--board-alert)" : "var(--board-ink-dim)" }}>
        {marketReadAt === null
          ? "The market has not been read yet, so only clause routes are ranked."
          : stale
            ? `Market read ${formatLeagueMoment(marketReadAt)}, over a day old. Expired auctions are left out.`
            : `Market read ${formatSyncedAt(marketReadAt, now)}${
                auctionClosesAt !== null && auctionClosesAt > now ? ` · auction closes ${formatLeagueMoment(auctionClosesAt)}` : ""
              }`}
      </p>

      <TargetControls view={view} positions={POSITIONS} />
      <TargetList rows={rows} lens={view.lens} />
      <LockedTargets rows={board.locked} />

      <p className="mt-6 text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
        Return: what a week like the last one would make on the real cost. Pts / M: points over the last three
        rounds per million of real cost. A listing costs 1.10× value by the managers&apos; house rule.
      </p>
    </section>
  );
}
