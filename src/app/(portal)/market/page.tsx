import { db } from "@/lib/db";
import { loadMarket } from "@/lib/db/queries";
import { requireSession } from "@/lib/auth/guards";
import { MarketFeed } from "@/components/market-feed";
import { PageHeader } from "@/components/page-header";

export default async function MarketPage() {
  await requireSession();
  const { operations, managerNames, playerNames, teamIdByManagerId, logBegan } =
    await loadMarket(db);

  return (
    <section className="mx-auto max-w-2xl">
      <PageHeader
        title="Market"
        note="Players are not sold before five days. Sales inside that window are marked."
        meta={`${operations.length} operations`}
      />

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
