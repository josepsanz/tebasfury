import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { loadPlayerCatalogue, loadSnapshots } from "@/lib/db/queries";
import { buildCatalogue } from "@/lib/domain/players";
import { parseMetric, rankFormations } from "@/lib/domain/lineup";
import { requireSession } from "@/lib/auth/guards";
import { PageHeader } from "@/components/page-header";
import { LineupBoard } from "@/components/lineup-board";

/**
 * The best eleven this manager could field, and every formation ranked.
 *
 * A page of its own rather than a section on `/teams/[id]`, which already carries
 * metrics, squad, money and market. It takes no entry in the nav — `nav-links.tsx`
 * records that the destination row is already at its width at 375px — and is reached from
 * the squad section instead.
 *
 * Both choices live in the URL: the page stays a server component, a lineup is a link
 * somebody can paste into the group chat, and the back button works.
 */
export default async function LineupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireSession();
  const { id } = await params;
  const query = await searchParams;

  const { teams } = await loadSnapshots(db);
  const team = teams.find((candidate) => candidate.id === id);
  // A 404, not an empty board: an id that matches nothing is a wrong address, exactly as
  // `/teams/[id]` already decides.
  if (!team) notFound();

  const catalogue = await loadPlayerCatalogue(db);
  const squad = buildCatalogue(catalogue).filter((row) => row.ownerTeamId === id);

  const metric = parseMetric(query.by);
  const ranked = rankFormations(squad, metric);

  const askedFor = Array.isArray(query.formation) ? query.formation[0] : query.formation;
  const showing =
    ranked.find((entry) => entry.name === askedFor && entry.shortfall === null) ??
    ranked.find((entry) => entry.shortfall === null) ??
    null;

  const other = metric === "points" ? "average" : "points";

  return (
    <section className="mx-auto max-w-2xl">
      <PageHeader
        title={`${team.managerName} — best lineup`}
        note="The highest-scoring eleven this squad can field, by formation. Injured, suspended and out-of-league players are left out; doubtful ones are counted and marked."
        meta={catalogue.ownershipKnown ? `${squad.length} in the squad` : undefined}
      />

      <p className="mt-2 flex items-center gap-3 text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
        <Link href={`/teams/${id}`} className="underline underline-offset-4">
          ← back to {team.managerName}
        </Link>
        <Link href={`/teams/${id}/lineup?by=${other}`} className="underline underline-offset-4">
          rank by {other === "points" ? "season points" : "average per gameweek"}
        </Link>
      </p>

      <LineupBoard
        ranked={ranked}
        showing={showing}
        metric={metric}
        teamId={id}
        ownershipKnown={catalogue.ownershipKnown}
      />
    </section>
  );
}
