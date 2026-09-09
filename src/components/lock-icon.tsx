/**
 * A padlock, closed.
 *
 * Drawn for a locked clause beside a name that is also greyed. **Colour is not the only
 * channel on purpose**: a reader who cannot separate the greens from the grey still sees a
 * padlock or no padlock, which is the whole distinction. The palette work on the progress
 * charts reached the same conclusion by measurement — six hues could not be made
 * colourblind-safe against this surface — and this is that lesson applied where it costs
 * one shape instead of a search.
 *
 * `aria-hidden`, like `PitchIcon`: the row already carries the words "locked until 14
 * Sept", and an icon repeating them would be announced twice.
 */
export function LockIcon({ size = 9 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={Math.round((size * 4) / 3)}
      viewBox="0 0 9 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      aria-hidden
      focusable="false"
      // Sits on the text baseline rather than the line box, so it does not push the row.
      style={{ display: "inline-block", verticalAlign: "-0.05em" }}
    >
      <rect x="0.5" y="5.5" width="8" height="6" />
      <path d="M2.5 5.5V3.5a2 2 0 0 1 4 0v2" />
    </svg>
  );
}
