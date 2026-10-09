import type { ReactNode } from "react";
import type { Breakfast } from "@/lib/necroporra/breakfasts";
import { formatBreakfastDay } from "@/lib/domain/breakfast-log";

/**
 * A list of breakfasts under a heading, in the order the caller gives. The page draws it
 * twice: the plans still to come, soonest first, and the history, newest first.
 *
 * For somebody who may record, each row is the summary of a `details` disclosure holding
 * the edit form, the same pattern `NecroporraBallots` uses: the list stays a server
 * component and the disclosure ships no JavaScript.
 */
export function BreakfastList({
  heading,
  empty,
  rows,
  teamName,
  editFor,
}: {
  heading: string;
  /** What to say when there are no rows, or null to draw nothing at all. */
  empty: string | null;
  rows: Breakfast[];
  teamName: Map<string, string>;
  editFor: ((row: Breakfast) => ReactNode) | null;
}) {
  if (rows.length === 0 && empty === null) return null;
  return (
    <>
      <h2
        className="mt-10 text-[11px] uppercase tracking-[0.06em]"
        style={{ color: "var(--board-ink-dim)" }}
      >
        {heading}
      </h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-[13px]" style={{ color: "var(--board-ink-dim)" }}>
          {empty}
        </p>
      ) : (
        <ul className="mt-3 border-t" style={{ borderColor: "var(--board-line)" }}>
          {rows.map((row) => {
            const name = teamName.get(row.teamId) ?? row.teamId;
            const line = (
              <span
                className={`grid items-baseline ${
                  editFor === null
                    ? "grid-cols-[76px_minmax(0,1fr)_auto]"
                    : "grid-cols-[76px_minmax(0,1fr)_auto_auto]"
                } gap-2 px-2 py-[6px]`}
              >
                <span
                  className="text-[12px] tabular-nums"
                  style={{ fontFamily: "var(--font-mono)", color: "var(--board-ink-dim)" }}
                >
                  {formatBreakfastDay(row.broughtOn)}
                </span>
                <span className="truncate text-[13px]">{name}</span>
                <span
                  className="max-w-[45vw] truncate text-right text-[12px] sm:max-w-[260px]"
                  style={{ color: "var(--board-ink-dim)" }}
                >
                  {row.what ?? ""}
                </span>
                {/* The sign that the row opens, for those who may open it. A hidden
                    disclosure marker with nothing in its place reads as a list that cannot
                    be corrected. */}
                {editFor === null ? null : (
                  <span
                    className="text-[11px] underline underline-offset-4"
                    style={{ color: "var(--board-ink-dim)" }}
                  >
                    Edit
                  </span>
                )}
              </span>
            );
            return (
              <li key={row.id} className="border-b" style={{ borderColor: "var(--board-line)" }}>
                {editFor === null ? (
                  line
                ) : (
                  <details>
                    <summary
                      className="cursor-pointer list-none [&::-webkit-details-marker]:hidden"
                      // The date is part of the name: one manager can bring several breakfasts,
                      // and the label replaces the row's own text for a screen reader.
                      aria-label={`Edit ${name}'s breakfast of ${formatBreakfastDay(row.broughtOn)}`}
                    >
                      {line}
                    </summary>
                    <div className="mb-3 px-2">{editFor(row)}</div>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
