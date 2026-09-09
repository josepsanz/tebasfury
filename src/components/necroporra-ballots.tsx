import type { RoundBallot } from "@/lib/domain/necroporra";

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
  viewerId,
  resolved,
}: {
  rows: RoundBallot[];
  teamName: Map<string, string>;
  viewerId: string;
  /** Whether the round has a last-placed team yet — a tick means nothing before that. */
  resolved: boolean;
}) {
  if (rows.length === 0) {
    return (
      <p className="mt-3 text-[13px]" style={{ color: "var(--board-ink-dim)" }}>
        Nobody can vote yet: no manager has claimed a team.
      </p>
    );
  }

  return (
    <ul className="mt-3 border-t" style={{ borderColor: "var(--board-line)" }}>
      {rows.map((row) => (
        <li
          key={row.userId}
          className="flex items-baseline justify-between gap-3 border-b px-2 py-[6px] text-[12.5px]"
          style={{
            borderColor: "var(--board-line)",
            background:
              row.userId === viewerId
                ? "color-mix(in srgb, var(--board-you) 10%, transparent)"
                : undefined,
          }}
        >
          <span
            className="min-w-0 shrink-0 truncate"
            style={{ color: row.userId === viewerId ? "var(--board-you)" : undefined }}
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
        </li>
      ))}
    </ul>
  );
}
