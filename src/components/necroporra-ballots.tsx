import type { ReactNode } from "react";
import type { RoundBallot } from "@/lib/domain/necroporra";
import { formatLeagueMoment } from "@/lib/domain/clock";

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
  enteredByName,
  castFor,
}: {
  rows: RoundBallot[];
  teamName: Map<string, string>;
  /** The reader's own team, so their row can be marked — null for an account with no claim. */
  viewerTeamId: string | null;
  /** Whether the round has a last-placed team yet — a tick means nothing before that. */
  resolved: boolean;
  /** Account names for whoever entered a ballot on somebody's behalf. */
  enteredByName: Map<string, string>;
  /**
   * What to draw for a row this reader may fill in, or null for a reader who may not.
   *
   * A render prop rather than a boolean, because the form is a client component and this
   * list is a server one: handing the form down keeps the list on the server and puts a
   * single client boundary on the page, instead of shipping thirteen forms to every
   * reader whether or not they may use one.
   */
  castFor: ((row: RoundBallot) => ReactNode) | null;
}) {
  if (rows.length === 0) {
    return (
      <p className="mt-3 text-[13px]" style={{ color: "var(--board-ink-dim)" }}>
        Nobody can vote yet: the league has no teams.
      </p>
    );
  }

  return (
    <ul className="mt-3 border-t" style={{ borderColor: "var(--board-line)" }}>
      {rows.map((row) => (
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
          <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
            <span
              className="min-w-0 shrink-0 truncate"
              style={{ color: row.teamId === viewerTeamId ? "var(--board-you)" : undefined }}
            >
              {row.name}
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

          {/* Shown to EVERYBODY, not only to admins. An entered ballot may be typed after
              the round has closed, and a privilege nobody can see is not one the league
              has agreed to. Words and no colour: the amber belongs to the reader's own
              row, and a second meaning would empty it of the first. */}
          {row.enteredBy === null ? null : (
            <p className="mt-[2px] text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
              entered by {enteredByName.get(row.enteredBy) ?? "an admin"}
              {row.castAt === null ? "" : ` · ${formatLeagueMoment(row.castAt)}`}
            </p>
          )}

          {/* `details` rather than a button and a piece of state: this list stays a server
              component, the disclosure costs no JavaScript, and the keyboard gets it for
              free. Thirteen of these could be open at once; nothing breaks if they are. */}
          {castFor === null ? null : (
            <details className="mt-1">
              <summary
                className="cursor-pointer text-[11px] underline underline-offset-4"
                style={{ color: "var(--board-ink-dim)" }}
              >
                {row.picks.length === 0 ? "Enter picks" : "Edit picks"}
              </summary>
              <div className="mb-2">{castFor(row)}</div>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}
