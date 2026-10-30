import type { ReactNode } from "react";
import Link from "next/link";
import { breaches, holdings, type Holding, type MarketOperation } from "@/lib/domain/market";
import { RULING_LABEL, UNRULED, type Ruling, type RulingStatus } from "@/lib/domain/fair-play-rulings";
import { formatLeagueMoment } from "@/lib/domain/clock";
import { shortOfTheHold } from "@/lib/domain/prose";
import { Profit } from "./profit";

/**
 * Every sale the league made inside its own five-day rule, newest first.
 *
 * The rule is the group's, not LaLiga's, and nothing can enforce it — the portal's brief
 * from the start has been that having it logged and visible is what changes behaviour. So
 * this page states facts and stops there: who, whom, how long they held them, how far short
 * that fell, and what the sale made. No verdict, no consequence, no tally of shame.
 *
 * **The shortfall is why the page reads row by row rather than as a table of counts.** Of
 * the four breaches this league has committed, three missed the rule by MINUTES and one by
 * three days. A column headed "breaches" would give both the same weight, and the number a
 * reader actually needs to judge is how short the sale fell.
 *
 * Beside each breach sits what the league decided about it — still pending, remedied or
 * waived — and an optional note. Facts about the league's answer, not a verdict of the
 * page's own: a breach nobody has ruled on says "Still pending". For somebody who may
 * rule, a `details` disclosure under the row holds the form, so the register stays a
 * server component.
 *
 * Two kinds of holding are deliberately absent, and the footnote says so for the second:
 *
 * - **A player taken by clause** (Ruling 3). The five-day rule is about choosing to sell;
 *   `holdings` already refuses to mark an involuntary end as a breach, so filtering on
 *   `breach` is all this needs.
 * - **A sale whose purchase predates the log.** The period is unknowable, which is never a
 *   breach and never a clean record either.
 */
export function FairPlayRegister({
  operations,
  managerNames,
  playerNames,
  teamIdByManagerId,
  rulings,
  editFor,
}: {
  operations: MarketOperation[];
  managerNames: Map<number, string>;
  playerNames: Map<string, string>;
  /** Manager id to team id, so a name can link to its page. */
  teamIdByManagerId: Map<number, string>;
  /** The league's ruling on each breach, by the id of the sale. No entry is still pending. */
  rulings: Map<string, Ruling>;
  /** The ruling form for a breach, or null for a reader who may not rule. */
  editFor: ((holding: Holding, ruling: Ruling) => ReactNode) | null;
}) {
  const closed = holdings(operations);
  const broken = [...breaches(operations)].sort(
    (a, b) => b.releasedAt.getTime() - a.releasedAt.getTime(),
  );

  /** Sales the rule cannot be measured on, because the purchase is older than the log. */
  const unjudged = closed.filter(
    (holding) => holding.voluntary && holding.hours === null,
  ).length;

  const linkClass = "underline decoration-[var(--board-line)] underline-offset-4";

  const manager = (id: number) => {
    const name = managerNames.get(id) ?? String(id);
    const teamId = teamIdByManagerId.get(id);
    return teamId === undefined ? (
      name
    ) : (
      <Link href={`/teams/${teamId}`} className={linkClass}>
        {name}
      </Link>
    );
  };

  const player = (id: string) => (
    <Link href={`/players/${id}`} className={linkClass}>
      {playerNames.get(id) ?? id}
    </Link>
  );

  /** Pending is the alert colour: the one status that still asks something of somebody. */
  const statusColor: Record<RulingStatus, string> = {
    pending: "var(--board-alert)",
    remedied: "var(--board-gain)",
    waived: "var(--board-free)",
  };

  const footnote =
    unjudged === 0 ? null : (
      <p className="mt-2 px-2 text-[10.5px]" style={{ color: "var(--board-ink-dim)" }}>
        {unjudged} {unjudged === 1 ? "sale" : "sales"} closed a holding that started
        before the log began. The rule cannot be measured on {unjudged === 1 ? "it" : "them"}.
      </p>
    );

  if (broken.length === 0) {
    return (
      <>
        <p className="mt-3 text-[13px]" style={{ color: "var(--board-ink-dim)" }}>
          Nobody has broken the five-day rule.
        </p>
        {footnote}
      </>
    );
  }

  return (
    <>
      <ol className="mt-3 border-t" style={{ borderColor: "var(--board-line)" }}>
        {broken.map((holding) => {
          const ruling = rulings.get(holding.releasedBy) ?? UNRULED;
          const line = (
            <span className="grid grid-cols-[1fr_auto] items-baseline gap-3 px-2 py-[7px]">
              <span className="min-w-0">
                <span className="block text-[13px]">
                  {manager(holding.managerId)} sold {player(holding.playerId)}{" "}
                  <span
                    className="whitespace-nowrap text-[11px]"
                    style={{ color: statusColor[ruling.status] }}
                  >
                    {RULING_LABEL[ruling.status]}
                  </span>
                </span>
                <span className="block text-[10.5px]">
                  <span style={{ color: "var(--board-alert)" }}>
                    {/* Three decimals, because the difference between twelve minutes and a
                        whole day is the difference between a slip and a decision. */}
                    held {((holding.hours as number) / 24).toFixed(3)} days —{" "}
                    {shortOfTheHold(holding.hours as number)}
                  </span>
                  {" · "}
                  <span
                    className="tabular-nums"
                    style={{ fontFamily: "var(--font-mono)", color: "var(--board-ink-dim)" }}
                  >
                    {formatLeagueMoment(holding.releasedAt)}
                  </span>
                </span>
                {ruling.note === null ? null : (
                  <span className="block text-[12px]" style={{ color: "var(--board-ink-dim)" }}>
                    {ruling.note}
                  </span>
                )}
              </span>
              <Profit value={holding.profit} />
            </span>
          );
          return (
            <li
              key={holding.releasedBy}
              className="border-b"
              style={{ borderColor: "var(--board-line)" }}
            >
              {line}
              {editFor === null ? null : (
                // Its own disclosure under the row, not the row as a summary: the row holds
                // two links, and a summary's label would hide them from a screen reader.
                <details className="px-2 pb-2">
                  <summary
                    className="cursor-pointer list-none text-[11px] underline underline-offset-4 [&::-webkit-details-marker]:hidden"
                    style={{ color: "var(--board-ink-dim)" }}
                    aria-label={`Edit the ruling on ${managerNames.get(holding.managerId) ?? holding.managerId}'s sale of ${playerNames.get(holding.playerId) ?? holding.playerId}`}
                  >
                    Edit ruling
                  </summary>
                  <div className="mt-2">{editFor(holding, ruling)}</div>
                </details>
              )}
            </li>
          );
        })}
      </ol>
      {footnote}
    </>
  );
}
