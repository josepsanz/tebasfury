export type Metric = { label: string; value: string; note?: string; tone?: "up" | "down" };

/**
 * A wrapping grid of figures with captions.
 *
 * Deliberately not an extension of `KpiStrip`: that is one row of three figures with
 * deltas, this is a wrapping grid of up to seven with captions, and one component made
 * to be both would be mostly conditionals.
 *
 * An unavailable metric arrives as its own reason in `value` ("Needs another round"),
 * never as a dash: a reader cannot tell a dash meaning zero from one meaning broken.
 */
export function MetricGrid({ items }: { items: Metric[] }) {
  if (items.length === 0) return null;

  return (
    <div className="mt-2 grid grid-cols-2 border-t" style={{ borderColor: "var(--board-line)" }}>
      {items.map((item) => (
        <div
          key={item.label}
          className="border-b border-r px-3 py-2"
          style={{ borderColor: "var(--board-line)" }}
        >
          <div className="text-[10px]" style={{ color: "var(--board-ink-dim)" }}>
            {item.label}
          </div>
          <div
            className="mt-0.5 text-[15px] tabular-nums leading-tight"
            style={{
              fontFamily: "var(--font-mono)",
              color:
                item.tone === "up"
                  ? "var(--board-gain)"
                  : item.tone === "down"
                    ? "var(--board-alert)"
                    : undefined,
            }}
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
  );
}
