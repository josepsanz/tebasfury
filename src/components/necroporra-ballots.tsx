import type { ReactNode } from "react";
import type { RoundBallot, RoundConsequences } from "@/lib/domain/necroporra";
import { formatLeagueMoment } from "@/lib/domain/clock";
import { GearIcon } from "@/components/gear-icon";

/**
 * Everyone's picks for one round — the open one included.
 *
 * Showing an open round's votes reverses this slice's original ruling, on the owner's
 * reasoning: *això fomenta el pique*. The argument between friends is the product, and a
 * poll nobody can needle each other about is a form.
 *
 * A manager who has not voted gets a row saying so rather than being left out. "Nobody
 * has heard from Bruno" is as much of a prod as the picks are, and an absence shown as an
 * absence cannot be misread as somebody who does not play.
 */
export function NecroporraBallots({
  rows,
  teamName,
  viewerTeamId,
  resolved,
  castFor,
  consequences = null,
}: {
  rows: RoundBallot[];
  teamName: Map<string, string>;
  /** The reader's own team, so their row can be marked — null for an account with no claim. */
  viewerTeamId: string | null;
  /** Whether the round has a last-placed team yet — a tick means nothing before that. */
  resolved: boolean;
  /**
   * What to draw for a row this reader may fill in, or null for a reader who may not.
   *
   * A render prop rather than a boolean, because the form is a client component and this
   * list is a server one: handing the form down keeps the list on the server and puts a
   * single client boundary on the page, instead of shipping thirteen forms to every
   * reader whether or not they may use one.
   */
  castFor: ((row: RoundBallot) => ReactNode) | null;
  /**
   * What this round costs whoever called it wrongly, or null while it has no verdict.
   *
   * Marks go on the rows as well as into the sentence above the list for the reason the
   * breakfast slice settled: a sentence names who, and a reader scanning thirteen rows
   * for their own name needs the row itself to say it.
   */
  consequences?: RoundConsequences | null;
}) {
  if (rows.length === 0) {
    return (
      <p className="mt-3 text-[13px]" style={{ color: "var(--board-ink-dim)" }}>
        Nobody can vote yet: the league has no teams.
      </p>
    );
  }

  /**
   * The one mark a row carries, if any. A hate message implies the apology that earned
   * it, so the two are one mark at two weights rather than two marks stacked on one row.
   */
  const mark = (teamId: string): string | null => {
    if (!consequences) return null;
    if (consequences.hateTargets.includes(teamId)) return "apology + hate message";
    return consequences.apologists.includes(teamId) ? "owes an apology" : null;
  };

  return (
    <ul className="mt-3 border-t" style={{ borderColor: "var(--board-line)" }}>
      {rows.map((row) => {
        // Drawn once and placed twice: on its own for a reader who may only look, and
        // inside the disclosure's summary for one who may fill the row in. Keeping it in
        // one expression is what stops the two drifting apart.
        const line = (
          <>
            <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
              <span
                className="flex min-w-0 items-baseline gap-1.5"
                style={{ color: row.teamId === viewerTeamId ? "var(--board-you)" : undefined }}
              >
                {/* The gear sits AFTER the name and OUTSIDE the truncating span — the same
                    shape the clause marks use, and for the reason this codebase has already
                    had to fix once: an icon inside a `truncate` is cut off by a long name. */}
                <span className="truncate">{row.name}</span>
                {/* Same placement as the gear above, for the same reason. Words rather
                    than a shape: these two marks say what they mean, and the colour only
                    repeats it. */}
                {mark(row.teamId) === null ? null : (
                  <span
                    className="shrink-0 text-[10.5px]"
                    style={{ color: "var(--board-alert)" }}
                  >
                    {mark(row.teamId)}
                  </span>
                )}
                {castFor === null ? null : (
                  <span className="shrink-0" style={{ color: "var(--board-ink-dim)" }}>
                    <GearIcon />
                  </span>
                )}
              </span>

              {row.picks.length === 0 ? (
                <span className="text-right text-[11.5px]" style={{ color: "var(--board-ink-dim)" }}>
                  has not voted
                </span>
              ) : (
                <span
                  className="min-w-0 text-right"
                  style={{ color: resolved && row.hit ? "var(--board-gain)" : undefined }}
                >
                  {row.picks.map((id) => teamName.get(id) ?? id).join(", ")}
                  {resolved && row.hit ? " ✓" : ""}
                </span>
              )}
            </div>

            {/* Shown to EVERYBODY, not only to admins, and from inside the summary so it
                stays visible while the row is shut. An entered ballot may be typed after
                the round has closed, and a privilege nobody can see is not one the league
                has agreed to.

                WHICH admin is deliberately not said — the owner's call, and a good one: the
                act is what the league needs to see, and the row would otherwise put one
                person's name against somebody else's picks. `necroporra_votes.entered_by`
                still records who, where accountability belongs.

                Words and no colour: the amber belongs to the reader's own row, and a second
                meaning would empty it of the first. */}
            {row.enteredBy === null ? null : (
              <p className="mt-[2px] text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
                entered by an admin
                {row.castAt === null ? "" : ` · ${formatLeagueMoment(row.castAt)}`}
              </p>
            )}
          </>
        );

        return (
          <li
            key={row.teamId}
            className="border-b px-2 py-[6px]"
            style={{
              borderColor: "var(--board-line)",
              background:
                row.teamId === viewerTeamId
                  ? "color-mix(in srgb, var(--board-you) 10%, transparent)"
                  : undefined,
            }}
          >
            {castFor === null ? (
              line
            ) : (
              /* `details` rather than a button and a piece of state: this list stays a
                 server component, the disclosure ships no JavaScript, and the keyboard
                 gets it for free. The whole row is the summary, on the owner's choice —
                 a big target on a phone, with the gear as the sign that it does
                 something. The native marker goes: the gear has replaced it. */
              <details>
                <summary
                  className="cursor-pointer list-none [&::-webkit-details-marker]:hidden"
                  // The accessible name the gear cannot carry. Without it the control
                  // announces itself as the row's text and never says what opening it does.
                  aria-label={`${row.picks.length === 0 ? "Enter" : "Edit"} picks for ${row.name}`}
                >
                  {line}
                </summary>
                <div className="mb-2">{castFor(row)}</div>
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}
