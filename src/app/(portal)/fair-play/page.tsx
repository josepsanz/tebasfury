import { db } from "@/lib/db";
import { loadMarket } from "@/lib/db/queries";
import { requireSession } from "@/lib/auth/guards";
import { breaches } from "@/lib/domain/market";
import { FairPlayRegister } from "@/components/fair-play-register";
import { PageHeader } from "@/components/page-header";

/**
 * The league's own rule, and every sale that broke it.
 *
 * Reads exactly what `/market` reads — the rule is arithmetic over the operation log, and
 * nothing about a breach is stored. A second, narrower query would be a second thing to
 * keep correct for no gain: the log is a few hundred rows.
 */
export default async function FairPlayPage() {
  await requireSession();
  const { operations, managerNames, playerNames, teamIdByManagerId, logBegan } =
    await loadMarket(db);
  const broken = breaches(operations);

  return (
    <section className="mx-auto max-w-2xl">
      <PageHeader
        title="Fair play"
        note="The league does not sell a player within five days of buying them. Nothing enforces it, so here is every sale that broke it."
        meta={`${broken.length} ${broken.length === 1 ? "breach" : "breaches"}`}
      />

      <FairPlayRegister
        operations={operations}
        managerNames={managerNames}
        playerNames={playerNames}
        teamIdByManagerId={teamIdByManagerId}
      />

      <p className="mt-6 text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
        {logBegan === null
          ? "Nothing captured yet."
          : `This register reaches back to ${logBegan.toISOString().slice(0, 10)}, which is as far as the API will go. A sale before that is unknowable rather than clean.`}
      </p>
    </section>
  );
}
