import Link from "next/link";
import type { RoundRow } from "@/lib/domain/standings";

/**
 * One round's table.
 *
 * Its own component rather than a mode on `StandingsTable`, which carries movement
 * between rounds, three-week form bars and a live column — none of which a single round
 * contains. There is no "up from 3rd" inside one week, and form is a sequence this view
 * does not have. Same grid, same amber "you", same manager link, so the two read as one
 * family without one of them growing four conditionals.
 */
export function RoundTable({
  rows,
  gameweek,
  myTeamId,
}: {
  rows: RoundRow[];
  gameweek: number;
  myTeamId?: string | null;
}) {
  const grid = "grid grid-cols-[24px_1fr_52px] items-center gap-2 px-2";
  // A round is either wholly recorded or wholly live, so the first row speaks for it.
  const derived = rows.some((r) => r.positionDerived);

  return (
    <div className="mt-3 border-t" style={{ borderColor: "var(--board-line)" }}>
      <div
        className={`${grid} py-[5px] text-[10px] uppercase tracking-[0.06em]`}
        style={{ background: "var(--board-panel)", color: "var(--board-ink-dim)" }}
      >
        <span>#</span>
        <span>
          Manager
          {/* Said in the table, not in a tooltip: somebody comparing this against the
              official app mid-round has to be able to see why the two might differ
              without hovering anything. */}
          {derived ? (
            <span className="ml-2 normal-case tracking-normal" style={{ color: "var(--board-you)" }}>
              provisional — places worked out from points
            </span>
          ) : null}
        </span>
        <span className="text-right">Round {gameweek}</span>
      </div>

      <ol>
        {rows.map((row) => (
          <li
            key={row.teamId}
            className={`${grid} border-b py-[6px]`}
            style={{
              borderColor: "var(--board-line)",
              background:
                row.teamId === myTeamId
                  ? "color-mix(in srgb, var(--board-you) 10%, transparent)"
                  : undefined,
            }}
          >
            <span
              className="text-[12px] tabular-nums"
              style={{
                fontFamily: "var(--font-mono)",
                color: row.teamId === myTeamId ? "var(--board-you)" : "var(--board-ink-dim)",
              }}
            >
              {row.position}
            </span>
            <span className="flex items-baseline gap-2 min-w-0">
              <Link
                href={`/teams/${row.teamId}`}
                className="truncate text-[13px] underline decoration-[var(--board-line)] underline-offset-4"
              >
                {row.managerName}
              </Link>
              {row.teamId === myTeamId ? (
                <span
                  aria-label="Your team"
                  className="shrink-0 text-[9.5px] uppercase tracking-[0.1em]"
                  style={{ color: "var(--board-you)" }}
                >
                  you
                </span>
              ) : null}
            </span>
            <span
              className="text-right text-[13px] tabular-nums"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {row.points}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
