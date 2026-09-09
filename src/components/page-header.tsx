/**
 * The head of a page, in the shape of a panel header.
 *
 * `meta` is the size of what is underneath — thirteen teams, 426 operations, 840
 * players. It is deliberately a count and not a timestamp: how fresh the data is now
 * lives in the status strip, on every page, and repeating it here would give a reader
 * two clocks to reconcile.
 */
export function PageHeader({
  title,
  note,
  meta,
}: {
  title: string;
  note?: string;
  meta?: string;
}) {
  return (
    <header className="mb-1">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-[15px] font-semibold">{title}</h1>
        {meta ? (
          <span
            className="shrink-0 text-[10.5px] tabular-nums"
            style={{ fontFamily: "var(--font-mono)", color: "var(--board-ink-dim)" }}
          >
            {meta}
          </span>
        ) : null}
      </div>
      {note ? (
        <p className="mt-1 text-[11.5px]" style={{ color: "var(--board-ink-dim)" }}>
          {note}
        </p>
      ) : null}
    </header>
  );
}
