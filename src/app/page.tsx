import { db } from "@/lib/db";
import { loadPlayerCatalogue } from "@/lib/db/queries";
import {
  bestValueForMoney,
  buildCatalogue,
  formatMoney,
  freeAndScoring,
  pointsPerMillion,
} from "@/lib/domain/players";
import { getSession } from "@/lib/auth/guards";
import { OpportunityBoard } from "@/components/opportunity-board";

export default async function HomePage() {
  const session = await getSession();

  // `getSession`, not `requireSession`: an anonymous visitor keeps the page they have
  // today rather than being redirected to /login, which would be a behaviour change
  // nobody asked for. Same conditional pattern `AppNav` already uses.
  if (!session) {
    return (
      <section className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-semibold">TebasFury</h1>
        <p className="mt-2" style={{ color: "var(--board-ink-dim)" }}>
          Management portal for our private LaLiga Fantasy league.
        </p>
      </section>
    );
  }

  // The same read `/players` runs, and no other. Ruling 7 names the cost: 840 players
  // and their aggregates for ten rows, in exchange for one place where the ranking
  // rules live and nothing crossing to the client.
  const { players, totals, values, ownership, clubs, ownershipKnown } =
    await loadPlayerCatalogue(db);
  const rows = buildCatalogue({ players, totals, values, ownership, clubs });

  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold">TebasFury</h1>
      <p className="mt-2" style={{ color: "var(--board-ink-dim)" }}>
        Management portal for our private LaLiga Fantasy league.
      </p>

      <OpportunityBoard
        title="Best value for money"
        note="Points per million of market value. Players with at least three recorded gameweeks, the same floor the catalogue's “Best average” uses."
        rows={bestValueForMoney(rows)}
        emptyNote="No player has three recorded gameweeks yet. This fills in as the season goes."
        figure={(row) => ({
          // `pointsPerMillion`, never the division written out again: the rule lives in
          // one place, which is the whole reason Ruling 7 refused a SQL ranking. The
          // fallback is unreachable — a non-null result is one of the two things
          // `bestValueForMoney` filters on — and is here to satisfy the type, not to
          // paper over a case.
          value: (pointsPerMillion(row.seasonPoints, row.currentValue) ?? 0).toFixed(1),
          unit: `pts/M€ · ${row.currentValue === null ? "—" : formatMoney(row.currentValue)}`,
        })}
        link={{ href: "/players?sort=perMillion", label: `All ${rows.length} by value for money` }}
        ownershipKnown={ownershipKnown}
      />

      <OpportunityBoard
        title="Free and scoring"
        note="Nobody in the league owns them. Ranked by season points."
        rows={freeAndScoring(rows)}
        emptyNote="No unowned player has scored yet."
        figure={(row) => ({
          value: String(row.seasonPoints),
          unit: `pts · ${row.currentValue === null ? "—" : formatMoney(row.currentValue)}`,
        })}
        link={{ href: "/players?ownership=free&sort=points", label: "All free agents" }}
        ownershipKnown={ownershipKnown}
        unknownOwnershipNote="No squad has been read yet, so nobody can be called free. The next sweep settles it."
      />
    </section>
  );
}
