import type { ReactNode } from "react";
import type { Breakfast } from "@/lib/necroporra/breakfasts";
import { formatBreakfastDay } from "@/lib/domain/breakfast-log";

/**
 * Every breakfast ever recorded, in the order the caller gives (newest first).
 *
 * For somebody who may record, each row is the summary of a `details` disclosure holding
 * the edit form, the same pattern `NecroporraBallots` uses: the list stays a server
 * component and the disclosure ships no JavaScript.
 */
export function BreakfastList({
  rows,
  teamName,
  editFor,
}: {
  rows: Breakfast[];
  teamName: Map<string, string>;
  editFor: ((row: Breakfast) => ReactNode) | null;
}) {
  return (
    <>
      <h2
        className="mt-10 text-[11px] uppercase tracking-[0.06em]"
        style={{ color: "var(--board-ink-dim)" }}
      >
        Every breakfast
      </h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-[13px]" style={{ color: "var(--board-ink-dim)" }}>
          Nobody has brought breakfast yet.
        </p>
      ) : (
        <ul className="mt-3 border-t" style={{ borderColor: "var(--board-line)" }}>
          {rows.map((row) => {
            const name = teamName.get(row.teamId) ?? row.teamId;
            const line = (
              <span className="grid grid-cols-[76px_minmax(0,1fr)_auto] items-baseline gap-2 px-2 py-[6px]">
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
                      aria-label={`Edit ${name}'s breakfast`}
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
