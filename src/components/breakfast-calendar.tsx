import Link from "next/link";
import type { Breakfast } from "@/lib/necroporra/breakfasts";
import { monthLabel, shiftMonth, type GridCell, type Month } from "@/lib/domain/breakfast-log";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * One month of the Calendar of Shame, Monday first.
 *
 * A breakfast day is the one loud thing on the page: tinted and bordered in the alert colour,
 * with every bringer's name under the number. Everything else stays at the portal's quiet
 * baseline, so the eye lands on the shame and nothing else. Today carries only an outline,
 * because it is a place to look from, not a fact.
 *
 * `min-w-0` on every cell is what keeps seven columns inside a 360 px phone: without it a
 * long manager name widens its column and the grid scrolls sideways.
 */
export function BreakfastCalendar({
  month,
  grid,
  today,
  teamName,
  prevHref,
  nextHref,
}: {
  month: Month;
  grid: GridCell<Breakfast>[][];
  today: string;
  teamName: Map<string, string>;
  prevHref: string;
  nextHref: string;
}) {
  const short = (m: Month) => monthLabel(m).split(" ")[0].slice(0, 3);

  return (
    <div className="mt-8">
      <div className="flex items-baseline justify-between gap-3 text-[12px]">
        <Link
          href={prevHref}
          className="underline-offset-4 hover:underline"
          style={{ color: "var(--board-ink-dim)" }}
        >
          ‹ {short(shiftMonth(month, -1))}
        </Link>
        <h2 className="text-[14px] font-semibold">{monthLabel(month)}</h2>
        <Link
          href={nextHref}
          className="underline-offset-4 hover:underline"
          style={{ color: "var(--board-ink-dim)" }}
        >
          {short(shiftMonth(month, 1))} ›
        </Link>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-[3px]">
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            className="pb-1 text-center text-[10.5px]"
            style={{ color: "var(--board-ink-dim)" }}
          >
            {day}
          </div>
        ))}

        {grid.flat().map((cell, i) => {
          if (cell === null) return <div key={`blank-${i}`} aria-hidden />;

          const shamed = cell.entries.length > 0;
          const isToday = cell.iso === today;
          return (
            <div
              key={cell.iso}
              className="min-h-[52px] min-w-0 rounded-[3px] border px-[5px] py-[4px]"
              style={{
                borderColor: shamed
                  ? "var(--board-alert)"
                  : isToday
                    ? "var(--board-ink-dim)"
                    : "var(--board-line)",
                background: shamed
                  ? "color-mix(in srgb, var(--board-alert) 16%, transparent)"
                  : undefined,
              }}
              aria-label={
                shamed
                  ? `${cell.day}: ${cell.entries.map((e) => teamName.get(e.teamId) ?? e.teamId).join(", ")}`
                  : undefined
              }
            >
              <span
                className="block text-[11px] tabular-nums"
                style={{
                  fontFamily: "var(--font-mono)",
                  color: shamed ? "var(--board-alert)" : "var(--board-ink-dim)",
                  fontWeight: shamed ? 600 : undefined,
                }}
              >
                {cell.day}
              </span>
              {cell.entries.map((entry) => (
                <span key={entry.id} className="mt-[2px] block truncate text-[10.5px] leading-tight">
                  {teamName.get(entry.teamId) ?? entry.teamId}
                </span>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
