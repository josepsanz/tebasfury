import type { ReactNode } from "react";
import { LockIcon } from "@/components/lock-icon";
import { ShieldIcon } from "@/components/shield-icon";
import type { ClauseStatus } from "@/lib/domain/market";

/**
 * How a clause state is drawn, in one place.
 *
 * The catalogue and a manager's squad both answer "can I take this player", so they say
 * it the same way — same hues, same marks, same words. Two copies of this would drift on
 * the first change, and a portal where green means one thing on one page is worse than
 * one that never coloured a name at all.
 *
 * One hue at two intensities for `takeable` and `soon`, because they are the same fact at
 * two distances rather than two categories. Deliberately NOT the portal's amber, which
 * means "your team" and nothing else — a colour that means two things means neither.
 *
 * The padlock on `locked` is the second channel: colour alone would fail a reader who
 * cannot separate the greens from the grey.
 */
export const CLAUSE_COLOUR: Record<ClauseStatus["state"], string> = {
  takeable: "var(--board-gain)",
  soon: "color-mix(in srgb, var(--board-gain) 55%, var(--board-ink-dim))",
  locked: "var(--board-ink-dim)",
  // A shield blocks a raid as surely as a lock does, so it reads as blocked. It carries
  // no expiry in the response, which is why it gets a mark and never a countdown.
  shielded: "var(--board-ink-dim)",
};

/**
 * A player's name, coloured by whether they can be taken, with the marks that say so
 * without relying on colour.
 *
 * The marks sit AFTER the name and OUTSIDE the truncating span, which is the same shape
 * `StandingsTable` uses for its "you" marker and for the same reason: a marker inside a
 * `truncate` is cut off by a long name, which this codebase has already had to fix once.
 * `min-w-0` lets the name shrink; `shrink-0` keeps each mark whole.
 *
 * After rather than before so every name starts at the same x — these lists are scanned
 * down their left edge, and an icon in front of some rows makes that edge ragged.
 *
 * `children` rather than a string: the catalogue wraps its whole row in one link, so the
 * name is plain text there, while a squad row links each name on its own.
 */
export function ClauseName({
  clause,
  children,
}: {
  /** Undefined for a player nobody holds — no colour, no marks. */
  clause?: ClauseStatus;
  children: ReactNode;
}) {
  return (
    <span
      className="flex min-w-0 items-baseline gap-1.5 text-[13px]"
      style={{ color: clause ? CLAUSE_COLOUR[clause.state] : undefined }}
      title={clause?.label}
    >
      <span className="truncate">{children}</span>
      {clause?.state === "locked" ? (
        <span className="shrink-0">
          <LockIcon />
        </span>
      ) : null}
      {/* Its own shape beside the padlock, not instead of it: a player can be locked AND
          shielded, and the two are different blocks with different lifetimes. */}
      {clause?.shielded ? (
        <span className="shrink-0">
          <ShieldIcon />
        </span>
      ) : null}
    </span>
  );
}

/**
 * The clause state in words, for the dim line under a name.
 *
 * Said in words as well as in colour: the hue answers "can I take this" at a glance, the
 * words answer "when" without a hover. Only a block gets words — writing "takeable"
 * beside most of a list would be noise, and the market's clause board is where the
 * takeable side is read in full.
 *
 * Renders its own leading separator, so a caller can drop it into a line of dot-separated
 * facts without deciding whether a dot is needed.
 */
export function ClauseNote({ clause }: { clause?: ClauseStatus }) {
  if (clause === undefined || clause.state === "takeable") return null;
  return <span style={{ color: CLAUSE_COLOUR[clause.state] }}> · {clause.label}</span>;
}
