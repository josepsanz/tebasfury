import { db } from "@/lib/db";
import { loadSnapshots } from "@/lib/db/queries";
import { requireSession } from "@/lib/auth/guards";
import { ARTICLES, prizePot } from "@/lib/domain/constitution";
import { ConstitutionArticles } from "@/components/constitution-articles";
import { PrizeLadder } from "@/components/prize-ladder";
import { PageHeader } from "@/components/page-header";

/**
 * The Constitution of the Fantasy Comité.
 *
 * The only page whose content is not derived from anything: the articles are the league's
 * own rulings, written down in `domain/constitution.ts`. The one thing it reads from the
 * database is how many managers are in, because that is what turns "65 % of the pot" into
 * a sum somebody can be handed at the end of the season.
 *
 * Only managers still in the league count. The one who left had not paid, so her 15 €
 * was never in the pot — the owner's ruling, 2026-09-25.
 */
export default async function ConstitutionPage() {
  await requireSession();
  const { activeTeams } = await loadSnapshots(db);
  const pot = prizePot(activeTeams.length);

  return (
    <section className="mx-auto max-w-2xl">
      <PageHeader
        title="The Constitution of the Fantasy Comité"
        note="The league's own law. None of it comes from LaLiga and none of it is enforced by anything but the league — these are the rules the managers agreed among themselves."
        meta={`${ARTICLES.length} articles`}
      />

      <ConstitutionArticles
        articles={ARTICLES}
        aside={(article) =>
          article.key === "stakes" ? (
            <PrizeLadder teamCount={activeTeams.length} pot={pot} />
          ) : null
        }
      />
    </section>
  );
}
