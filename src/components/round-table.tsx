import Link from "next/link";
import type { RoundRow } from "@/lib/domain/standings";
import type { BreakfastDuty } from "@/lib/domain/breakfast";
import { ShieldIcon } from "@/components/shield-icon";

/**
 * One round's table.
 *
 * Its own component rather than a mode on `StandingsTable`, which carries movement
 * between rounds, three-week form bars and a live column — none of which a single round
 * contains. There is no "up from 3rd" inside one week, and form is a sequence this view
 * does not have. Same grid, same amber "you", same manager link, so the two read as one
 * family without one of them growing four conditionals.
 *
 * `duty` is the one thing this table adds beyond `StandingsTable`: it names who this
 * round's last place obliges, and marks whoever a shield is still covering — the mark a
 * reader looking at the bottom of the table needs when the last-placed team is not the
 * one named.
 *
 * A provisional duty marks the same two things with one difference: the bringer's mark
 * becomes a question, because that name follows points that are still climbing, while the
 * shield stays flat, because it was decided by rounds that have finished.
 */
export function RoundTable({
  rows,
  gameweek,
  myTeamId,
  duty,
}: {
  rows: RoundRow[];
  gameweek: number;
  myTeamId?: string | null;
  /** `undefined` (not wired up) reads the same as `null` (no duty this round): no marks. */
  duty?: BreakfastDuty | null;
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
        {rows.map((row) => {
          const brings = duty?.bringers.includes(row.teamId) ?? false;
          const shield = duty?.shielded.find((s) => s.teamId === row.teamId);

          return (
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
                {/* Neither the amber ("you") nor the green (a market gain) — this is a
                    third fact and gets a third colour, plus its own word, so a reader who
                    cannot tell hues apart still learns it from the text alone. A round
                    still being played adds a question mark and nothing else: the hedge is a
                    character of text, so it survives the colour being lost, and it sits
                    beside a header already calling the places provisional. The shield below
                    is NOT hedged — it was settled by the rounds that have finished. */}
                {brings ? (
                  <span
                    aria-label={
                      duty?.provisional
                        ? "Provisionally brings breakfast"
                        : "Brings breakfast this round"
                    }
                    className="shrink-0 text-[9.5px] uppercase tracking-[0.1em]"
                    style={{ color: "var(--board-alert)" }}
                  >
                    brings breakfast{duty?.provisional ? "?" : ""}
                  </span>
                ) : null}
                {/* Same shield the catalogue draws for a raid-proof clause, because it is
                    the same fact: this team is answering for someone else right now. The
                    count is the whole reason it is here — it is the answer to "why isn't
                    the bottom row the one named above". */}
                {shield ? (
                  <span
                    aria-label={`Shielded, ${shield.roundsLeft} round${shield.roundsLeft === 1 ? "" : "s"} left`}
                    className="shrink-0 inline-flex items-center gap-1 text-[9.5px] uppercase tracking-[0.1em]"
                    style={{ color: "var(--board-ink-dim)" }}
                  >
                    <ShieldIcon size={9} />
                    shielded · {shield.roundsLeft}
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
          );
        })}
      </ol>
    </div>
  );
}
