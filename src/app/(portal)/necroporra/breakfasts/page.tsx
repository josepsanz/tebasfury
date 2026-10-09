import type { ReactNode } from "react";
import Link from "next/link";
import { db } from "@/lib/db";
import { loadSnapshots } from "@/lib/db/queries";
import { loadBreakfasts, type Breakfast } from "@/lib/necroporra/breakfasts";
import { decideAccess, requireSession } from "@/lib/auth/guards";
import {
  monthGrid,
  monthParam,
  parseMonth,
  shiftMonth,
  todayInLeague,
  isPlanned,
} from "@/lib/domain/breakfast-log";
import { urlWithParam } from "@/components/picker-url";
import { PageHeader } from "@/components/page-header";
import { BreakfastCalendar } from "@/components/breakfast-calendar";
import { BreakfastList } from "@/components/breakfast-list";
import { BreakfastForm } from "@/components/breakfast-form";
import { BreakfastDelete } from "@/components/breakfast-delete";
import { deleteBreakfast, recordBreakfast, updateBreakfast } from "./actions";

const BASE = "/necroporra/breakfasts";

export default async function BreakfastsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await requireSession();
  const today = todayInLeague(new Date());
  const [rows, { teams, activeTeams }] = await Promise.all([loadBreakfasts(db), loadSnapshots(db)]);

  const params = await searchParams;
  const asked = Array.isArray(params.month) ? params.month[0] : params.month;
  const month = parseMonth(asked, today);

  // Every other parameter survives a step, as on every picker in the portal.
  const query = new URLSearchParams(
    Object.entries(params).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])),
  );
  const hrefFor = (by: 1 | -1) => urlWithParam(BASE, query, "month", monthParam(shiftMonth(month, by)));

  const teamName = new Map(teams.map((t) => [t.id, t.managerName]));
  const mayRecord = decideAccess(session, { breakfast: ["record"] }).kind === "allow";
  // New entries name the league as it is; an old entry keeps whoever it names.
  const choosable = activeTeams.map((t) => ({ id: t.id, managerName: t.managerName }));

  // A plan becomes history on its own day, so the split is redrawn on every read and
  // nothing has to move a row from one list to the other. Plans run soonest first; the
  // rows arrive newest first, which for days still to come is the far end.
  const planned = rows.filter((row) => isPlanned(row, today)).reverse();
  const brought = rows.filter((row) => !isPlanned(row, today));

  const editFor: ((row: Breakfast) => ReactNode) | null = mayRecord
    ? (row) => {
        const name = teamName.get(row.teamId) ?? row.teamId;
        // The current team stays choosable on an edit even if they have left.
        const options = choosable.some((t) => t.id === row.teamId)
          ? choosable
          : [...choosable, { id: row.teamId, managerName: name }];
        return (
          <>
            <BreakfastForm
              teams={options}
              action={updateBreakfast}
              today={today}
              initial={row}
              submitLabel={`Save ${name}'s breakfast`}
            />
            <BreakfastDelete
              id={row.id}
              label={`Delete ${name}'s breakfast? This cannot be undone.`}
              action={deleteBreakfast}
            />
          </>
        );
      }
    : null;

  return (
    <section className="mx-auto max-w-2xl">
      <PageHeader
        title="Calendar of Shame"
        note="Every penalty breakfast the league has eaten, and the ones already promised: who, when, and what."
        meta={brought.length === 1 ? "1 breakfast" : `${brought.length} breakfasts`}
      />
      <p className="mt-2 text-[12px]">
        <Link href="/necroporra" className="underline underline-offset-4">‹ Necroporra</Link>
      </p>

      {mayRecord ? (
        <BreakfastForm teams={choosable} action={recordBreakfast} today={today} submitLabel="Record" />
      ) : null}

      <BreakfastCalendar
        month={month}
        grid={monthGrid(month, rows)}
        today={today}
        teamName={teamName}
        prevHref={hrefFor(-1)}
        nextHref={hrefFor(1)}
      />

      <BreakfastList
        heading="Coming up"
        empty={null}
        rows={planned}
        teamName={teamName}
        editFor={editFor}
      />

      <BreakfastList
        heading="Every breakfast"
        empty="Nobody has brought breakfast yet."
        rows={brought}
        teamName={teamName}
        editFor={editFor}
      />
    </section>
  );
}
