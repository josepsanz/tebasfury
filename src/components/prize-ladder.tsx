import { ENTRY_FEE_EUROS, formatEuros, type prizePot } from "@/lib/domain/constitution";

/** The places the pot pays, in the order it pays them. */
const PLACES = ["Champion", "Runner-up", "Third"];

/**
 * What the season is worth, in money.
 *
 * The one figure in the Constitution, and the reason it is here rather than left as three
 * percentages: "65 % of the pot" is not a number anybody can spend, and the pot is not a
 * fixed sum — it is however many managers turned up, times the fee. The portal knows how
 * many turned up, so it can say 126.75 € where the law says 65 %.
 *
 * Set in the mono face like every other figure on the board. A reader comparing the three
 * prizes is comparing numbers, and numbers only line up when the digits are the same width.
 */
export function PrizeLadder({
  teamCount,
  pot,
}: {
  teamCount: number;
  pot: ReturnType<typeof prizePot>;
}) {
  // Before the first sync the league has no teams, and three prizes of 0.00 € would be
  // arithmetic nobody asked for. The split is still the law, so the shares stay and the
  // money waits for the managers.
  const paying = teamCount > 0;

  return (
    <div className="mt-4 max-w-xs border-t" style={{ borderColor: "var(--board-line)" }}>
      <div
        className="flex items-baseline justify-between gap-3 border-b px-2 py-2"
        style={{ borderColor: "var(--board-line)" }}
      >
        <span className="text-[11.5px]" style={{ color: "var(--board-ink-dim)" }}>
          {paying
            ? `${teamCount} manager${teamCount === 1 ? "" : "s"} × ${ENTRY_FEE_EUROS} €`
            : "no managers yet"}
        </span>
        {paying ? (
          <span className="text-[19px] tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>
            {formatEuros(pot.potCents)}
          </span>
        ) : null}
      </div>

      <ol>
        {pot.prizes.map((prize) => (
          <li
            key={prize.place}
            className="flex items-baseline justify-between gap-3 border-b px-2 py-[6px]"
            style={{ borderColor: "var(--board-line)" }}
          >
            <span className="text-[12.5px]">{PLACES[prize.place - 1]}</span>
            <span className="flex items-baseline gap-3">
              <span
                className="text-[11px] tabular-nums"
                style={{ fontFamily: "var(--font-mono)", color: "var(--board-ink-dim)" }}
              >
                {prize.share} %
              </span>
              {paying ? (
                <span
                  className="text-[12.5px] tabular-nums"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {formatEuros(prize.cents)}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
