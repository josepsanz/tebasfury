export type Kpi = {
  label: string;
  value: string;
  /** Movement since the last settled round. Absent when there is nothing to compare to. */
  delta?: { text: string; rising: boolean };
};

/**
 * The three figures a manager opens the portal to check.
 *
 * A strip rather than three cards: cards would put a border and a shadow around numbers
 * that belong to the same glance, and this reads as one instrument with three needles.
 *
 * The delta is the only place colour appears, and it uses the market's two words —
 * green up, red down. Amber is never used here: amber means "you", and on a strip that
 * is entirely about you it would say nothing.
 */
export function KpiStrip({ items }: { items: Kpi[] }) {
  if (items.length === 0) return null;

  return (
    <div
      className="mt-3 grid border-y"
      style={{
        borderColor: "var(--board-line)",
        gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`,
      }}
    >
      {items.map((item, i) => (
        <div
          key={item.label}
          className="px-3 py-2"
          style={{
            borderLeft: i === 0 ? undefined : "1px solid var(--board-line)",
          }}
        >
          <div className="text-[10px]" style={{ color: "var(--board-ink-dim)" }}>
            {item.label}
          </div>
          <div
            className="mt-0.5 text-[17px] tabular-nums leading-none"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {item.value}
          </div>
          {item.delta ? (
            <div
              className="mt-1 text-[10.5px] tabular-nums"
              style={{
                fontFamily: "var(--font-mono)",
                color: item.delta.rising ? "var(--board-gain)" : "var(--board-alert)",
              }}
            >
              {item.delta.rising ? "▲" : "▼"} {item.delta.text}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
