import type { MarketSummary, MoneySide } from "@/lib/domain/market";
import { formatMoney } from "@/lib/domain/players";

/**
 * A manager's money: four ways it moved, then the three figures that sum them.
 *
 * A table rather than sixteen tiles. These are four rows of the same four measurements,
 * and the whole question a reader has — did buying cost more than selling brought in,
 * and how much of that was clauses — is a comparison down a column. Tiles would put a
 * border between every pair of numbers that exist to be compared.
 *
 * The four sides are kept apart because **a clause payment is not a sale**. Being charged
 * for a player somebody took off you is money in, but you did not choose to sell — the
 * same refusal `holdings` makes for the five-day rule, so the money view and the fair-play
 * view now use the word the same way.
 */

const MONEY = "text-right text-[12px] tabular-nums";

/** Correctly pluralised, so a manager with one deal does not read "1 operations". */
const operations = (count: number) => `${count} ${count === 1 ? "operation" : "operations"}`;
const MONO = { fontFamily: "var(--font-mono)" };

function Row({
  label,
  hint,
  side,
  nameOf,
  tone,
}: {
  label: string;
  hint: string;
  side: MoneySide;
  nameOf: (playerId: string) => string | undefined;
  tone: "in" | "out";
}) {
  const grid = "grid grid-cols-[1fr_34px_58px_58px] items-baseline gap-2 px-2";
  // A dash is safe HERE and nowhere else in this portal: the count sits in the next
  // column and says nought, so "—" cannot be mistaken for a figure that failed to load.
  const money = (value: number | null) => (value === null ? "—" : formatMoney(value));

  return (
    <li className="border-b py-[6px]" style={{ borderColor: "var(--board-line)" }}>
      <div className={grid}>
        <span className="min-w-0 truncate text-[12.5px]">
          {label}
          <span
            className="ml-2 text-[9.5px] uppercase tracking-[0.08em]"
            style={{ color: tone === "in" ? "var(--board-gain)" : "var(--board-alert)" }}
          >
            {tone}
          </span>
        </span>
        <span
          className="text-right text-[11px] tabular-nums"
          style={{ ...MONO, color: "var(--board-ink-dim)" }}
        >
          {side.count}
        </span>
        <span className={MONEY} style={MONO}>
          {money(side.count === 0 ? null : side.total)}
        </span>
        <span className={MONEY} style={{ ...MONO, color: "var(--board-ink-dim)" }}>
          {money(side.average)}
        </span>
      </div>

      <div className="px-2 text-[10px]" style={{ color: "var(--board-ink-dim)" }}>
        {side.biggest === null ? (
          hint
        ) : (
          <>
            biggest {formatMoney(side.biggest.amount)}
            {nameOf(side.biggest.playerId) ? ` — ${nameOf(side.biggest.playerId)}` : ""}
          </>
        )}
      </div>
    </li>
  );
}

export function MarketMoney({
  summary,
  nameOf,
}: {
  summary: MarketSummary;
  nameOf: (playerId: string) => string | undefined;
}) {
  const header = "grid grid-cols-[1fr_34px_58px_58px] items-baseline gap-2 px-2";

  return (
    <>
      <div className="mt-2 border-t" style={{ borderColor: "var(--board-line)" }}>
        <div
          className={`${header} py-[5px] text-[10px] uppercase tracking-[0.06em]`}
          style={{ background: "var(--board-panel)", color: "var(--board-ink-dim)" }}
        >
          <span />
          <span className="text-right">Ops</span>
          <span className="text-right">Total</span>
          <span className="text-right">Avg</span>
        </div>

        <ul>
          <Row
            label="Bought"
            hint="Nothing bought yet"
            side={summary.bought}
            nameOf={nameOf}
            tone="out"
          />
          <Row label="Sold" hint="Nothing sold yet" side={summary.sold} nameOf={nameOf} tone="in" />
          <Row
            label="Clauses paid"
            hint="No player taken by clause"
            side={summary.clausesPaid}
            nameOf={nameOf}
            tone="out"
          />
          <Row
            label="Clauses charged"
            hint="No player taken off them"
            side={summary.clausesCharged}
            nameOf={nameOf}
            tone="in"
          />
        </ul>
      </div>

      <div
        className="grid grid-cols-3 border-b"
        style={{ borderColor: "var(--board-line)" }}
      >
        {[
          {
            label: "Cash in",
            value: formatMoney(summary.cashIn),
            note: operations(summary.sold.count + summary.clausesCharged.count),
          },
          {
            label: "Cash out",
            value: formatMoney(summary.cashOut),
            note: operations(summary.bought.count + summary.clausesPaid.count),
          },
          {
            label: "Difference",
            // No count: a difference is not made of operations, and a number here would
            // invite the reader to divide by it.
            note: undefined,
            // Signed and coloured, because the direction is the whole content. Exactly
            // level gets no colour — it is neither, and tinting it would make a reader
            // look for a reason.
            value:
              summary.difference === 0
                ? formatMoney(0)
                : `${summary.difference > 0 ? "+" : "−"}${formatMoney(Math.abs(summary.difference))}`,
            tone:
              summary.difference === 0
                ? undefined
                : summary.difference > 0
                  ? "var(--board-gain)"
                  : "var(--board-alert)",
          },
        ].map((item, i) => (
          <div
            key={item.label}
            className="px-2 py-2"
            style={{ borderLeft: i === 0 ? undefined : "1px solid var(--board-line)" }}
          >
            <div className="text-[10px]" style={{ color: "var(--board-ink-dim)" }}>
              {item.label}
            </div>
            <div
              className="mt-0.5 text-[14px] tabular-nums leading-none"
              style={{ ...MONO, color: "tone" in item ? item.tone : undefined }}
            >
              {item.value}
            </div>
            {item.note ? (
              <div className="mt-0.5 text-[10px]" style={{ color: "var(--board-ink-dim)" }}>
                {item.note}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </>
  );
}
