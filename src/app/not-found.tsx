import Link from "next/link";

/**
 * Next's own fallback for an uncaught `notFound()` injects `body{color:#000;
 * background:#fff}` behind a `prefers-color-scheme` check it never asks this portal
 * about — this app sets `color-scheme: dark` on `:root` and stops there, on purpose,
 * so a device in light mode would see a white page with black text under the dark
 * nav. This file replaces that fallback with one on the board's own tokens, rendered
 * inside the root layout like any other page, so it inherits the nav and the dark
 * ground for free.
 *
 * Copy is an invitation rather than a dead end: the one `notFound()` call in the
 * codebase today is the player detail page, for an id that has left the catalogue or
 * was never in it.
 */
export default function NotFound() {
  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="text-xl font-medium">Not in the catalogue</h1>
      <p className="mt-2 text-[13px]" style={{ color: "var(--board-ink-dim)" }}>
        This player is not in the catalogue — they may have left the competition, or
        the link may be out of date.
      </p>
      <Link href="/players" className="board-button mt-6 inline-block">
        Back to players
      </Link>
    </section>
  );
}
