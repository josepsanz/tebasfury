/**
 * A pitch, seen from above.
 *
 * The portal's first icon, so it sets the shape of any that follow: inline SVG rather than
 * a library — the project has no icon dependency and does not need one for a dozen strokes
 * — drawn in `currentColor` so it takes the colour of whatever it sits in, and at a stroke
 * width that matches the board's own hairlines rather than shouting over them.
 *
 * `aria-hidden` on purpose. An icon standing in for a label is decoration; the accessible
 * name belongs on the control wrapping it, which is the only thing a screen reader should
 * announce. Two names for one target is worse than none.
 */
export function PitchIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      // Rounded: a fractional pixel height blurs a one-pixel stroke.
      height={Math.round((size * 2) / 3)}
      viewBox="0 0 24 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      aria-hidden
      focusable="false"
    >
      <rect x="0.5" y="0.5" width="23" height="15" />
      <line x1="12" y1="0.5" x2="12" y2="15.5" />
      <circle cx="12" cy="8" r="2.8" />
      <rect x="0.5" y="4.5" width="3.5" height="7" />
      <rect x="20" y="4.5" width="3.5" height="7" />
    </svg>
  );
}
