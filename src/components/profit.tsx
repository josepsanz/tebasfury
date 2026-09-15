import { formatMoney } from "@/lib/domain/players";

/**
 * What a holding made or lost.
 *
 * Nothing at all when the purchase predates the log — calling an unknowable profit nought
 * would report a manager who doubled their money as having broken even.
 *
 * Its own module because two pages draw it: the market feed and the fair-play register,
 * where the money a breach made is half of what the reader is judging.
 */
export function Profit({ value }: { value: number | null }) {
  if (value === null) return null;
  return (
    <span
      className="tabular-nums"
      style={{
        fontFamily: "var(--font-mono)",
        color:
          value > 0
            ? "var(--board-gain)"
            : value < 0
              ? "var(--board-alert)"
              : "var(--board-ink-dim)",
      }}
    >
      {value > 0 ? "▲ " : value < 0 ? "▼ " : ""}
      {formatMoney(Math.abs(value))}
    </span>
  );
}
