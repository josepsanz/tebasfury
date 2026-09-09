/**
 * An hourglass: the five-day fair-play hold.
 *
 * A third shape beside the padlock and the shield, and a third distinct meaning. The
 * padlock says nobody can take this player from their owner; the hourglass says the owner
 * cannot sell them yet. Same fourteen-day purchase, opposite directions.
 *
 * It appears only on a manager's own squad page, because that is the only place the
 * question "can this be moved on" is asked. The catalogue is read the other way round.
 *
 * It speaks when it is alone and stays quiet when it is not: beside a name it is the only
 * thing saying what it says, so it carries its own accessible name; in the legend under
 * the squad the words do that job, and a second voice would be announced twice.
 */
export function HoldIcon({ size = 9, label }: { size?: number; label?: string }) {
  return (
    <svg
      width={size}
      height={Math.round((size * 4) / 3)}
      viewBox="0 0 9 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      role={label === undefined ? undefined : "img"}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
      focusable="false"
      style={{ display: "inline-block", verticalAlign: "-0.05em" }}
    >
      {label === undefined ? null : <title>{label}</title>}
      {/* Two frames and the waist between them. Drawn as one path so the strokes meet
          cleanly at 1px rather than doubling where the triangles touch. */}
      <path d="M1 0.5h7M1 11.5h7M1.5 0.5v2.2L4.5 6l3-3.3V0.5M1.5 11.5V9.3L4.5 6l3 3.3v2.2" />
    </svg>
  );
}
