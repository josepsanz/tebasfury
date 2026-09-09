/**
 * A shield.
 *
 * The owner's extra 24-hour block, which the API reports as a bare `isShielded` boolean
 * with no expiry — so it can be marked but never counted down, and the mark is the whole
 * of what this portal can honestly say about it.
 *
 * Drawn as a second, distinct shape rather than a second colour, for the reason the
 * padlock is: a reader who cannot separate the hues still sees a shield, a padlock, or
 * neither, and those are three different states. `aria-hidden`, because the row's own
 * words carry the meaning.
 */
export function ShieldIcon({ size = 10 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={Math.round((size * 6) / 5)}
      viewBox="0 0 10 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      aria-hidden
      focusable="false"
      style={{ display: "inline-block", verticalAlign: "-0.05em" }}
    >
      <path d="M5 0.6 9.4 2.2v4.1c0 2.5-1.8 4.2-4.4 5.1C2.4 10.5.6 8.8.6 6.3V2.2Z" />
    </svg>
  );
}
