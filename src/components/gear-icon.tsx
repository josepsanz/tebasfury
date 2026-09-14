/**
 * A gear, for a row whose ballot the reader may fill in.
 *
 * The house shape, set by `PitchIcon`: inline SVG rather than a library, drawn in
 * `currentColor` so it takes the colour of the row it sits in, at the board's own hairline
 * stroke rather than shouting over it.
 *
 * A gear and not a wrench, on the owner's choice of the two: at twelve pixels a wrench
 * collapses into a stick, while a gear stays a circle with bumps — and a wrench says
 * "repair", which entering somebody's ballot is not.
 *
 * `aria-hidden`, like every other icon here. The disclosure that wraps it carries the
 * accessible name; two names for one control is worse than none.
 */
export function GearIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      aria-hidden
      focusable="false"
    >
      <circle cx="8" cy="8" r="2.4" />
      {/* Eight teeth, as straight strokes out of a ring: at this size a toothed outline
          turns to mud, and a ring with spokes still reads as a gear. */}
      <circle cx="8" cy="8" r="5" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => {
        const radians = (angle * Math.PI) / 180;
        const inner = 5;
        const outer = 7;
        return (
          <line
            key={angle}
            x1={8 + inner * Math.cos(radians)}
            y1={8 + inner * Math.sin(radians)}
            x2={8 + outer * Math.cos(radians)}
            y2={8 + outer * Math.sin(radians)}
          />
        );
      })}
    </svg>
  );
}
