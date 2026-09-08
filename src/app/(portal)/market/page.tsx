import { db } from "@/lib/db";
import { loadMarket } from "@/lib/db/queries";
import { requireSession } from "@/lib/auth/guards";
import { MarketFeed } from "@/components/market-feed";

export default async function MarketPage() {
  await requireSession();
  const { operations, managerNames, playerNames, logBegan } = await loadMarket(db);

  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="text-xl font-medium">Market</h1>
      <p className="mt-1 text-[13px]" style={{ color: "var(--board-ink-dim)" }}>
        Players are not sold before five days. Sales inside that window are marked.
      </p>

      <MarketFeed operations={operations} managerNames={managerNames} playerNames={playerNames} />

      <p className="mt-6 text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
        {logBegan === null
          ? "Nothing captured yet."
          : `This log reaches back to ${logBegan.toISOString().slice(0, 10)}. The API keeps only seven days, so anything before that is unknowable rather than clean.`}
      </p>
    </section>
  );
}
