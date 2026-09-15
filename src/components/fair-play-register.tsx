import Link from "next/link";
import { breaches, holdings, type MarketOperation } from "@/lib/domain/market";
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
}: {
  operations: MarketOperation[];
  managerNames: Map<number, string>;
  playerNames: Map<string, string>;
  /** Manager id to team id, so a name can link to its page. */
  teamIdByManagerId: Map<number, string>;
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
        {broken.map((holding) => (
          <li
            key={`${holding.managerId}:${holding.playerId}:${holding.releasedAt.getTime()}`}
            className="grid grid-cols-[1fr_auto] items-baseline gap-3 border-b px-2 py-[7px]"
            style={{ borderColor: "var(--board-line)" }}
          >
            <span className="min-w-0">
              <span className="block text-[13px]">
                {manager(holding.managerId)} sold {player(holding.playerId)}
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
            </span>
            <Profit value={holding.profit} />
          </li>
        ))}
      </ol>
      {footnote}
    </>
  );
}
