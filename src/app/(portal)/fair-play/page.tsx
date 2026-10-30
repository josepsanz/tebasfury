import { db } from "@/lib/db";
import { loadMarket } from "@/lib/db/queries";
import { decideAccess, requireSession } from "@/lib/auth/guards";
import { breaches } from "@/lib/domain/market";
import { loadRulings } from "@/lib/fair-play/rulings";
import { FairPlayRegister } from "@/components/fair-play-register";
import { FairPlayRulingForm } from "@/components/fair-play-ruling-form";
import { PageHeader } from "@/components/page-header";
import { ruleOnBreach } from "./actions";

/**
 * The league's own rule, and every sale that broke it.
 *
 * Reads exactly what `/market` reads — the rule is arithmetic over the operation log, and
 * nothing about a breach is stored. A second, narrower query would be a second thing to
 * keep correct for no gain: the log is a few hundred rows. What IS stored is the league's
 * ruling on each breach, which only an admin or a collaborator may set.
 */
export default async function FairPlayPage() {
  const session = await requireSession();
  const [{ operations, managerNames, playerNames, teamIdByManagerId, logBegan }, rulings] =
    await Promise.all([loadMarket(db), loadRulings(db)]);
  const broken = breaches(operations);
  const mayRule = decideAccess(session, { fairplay: ["annotate"] }).kind === "allow";

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
        rulings={rulings}
        editFor={
          mayRule
            ? (holding, ruling) => (
                <FairPlayRulingForm
                  saleId={holding.releasedBy}
                  ruling={ruling}
                  action={ruleOnBreach}
                  submitLabel="Save ruling"
                />
              )
            : null
        }
      />

      <p className="mt-6 text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
        {logBegan === null
          ? "Nothing captured yet."
          : `This register reaches back to ${logBegan.toISOString().slice(0, 10)}, which is as far as the API will go. A sale before that is unknowable rather than clean.`}
      </p>
    </section>
  );
}
