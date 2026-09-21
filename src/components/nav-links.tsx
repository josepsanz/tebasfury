"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Where you can go, and where you are.
 *
 * A client component for one reason: `usePathname`. With nine destinations the bar needs
 * to say which one you are on, and a server component cannot know. `AppNav` stays on
 * the server for the session, so this is the smallest piece that has to ship to the
 * browser.
 *
 * `flex-wrap` is load-bearing, not defensive. These labels come to roughly the width
 * available at 375px, so the row fits with little to spare — and "My team", or a reader
 * whose system text is a size larger, would otherwise lose a destination off the edge
 * with nothing to show that it happened. It now carries nine labels, "Fair play" and
 * "Constitution" among them, so on a phone the row settles on two lines rather than one.
 */
export function NavLinks({
  canTriggerSync,
  myTeamId,
}: {
  canTriggerSync: boolean;
  myTeamId: string | null;
}) {
  const pathname = usePathname();

  const destinations = [
    // First, because it is the only destination that belongs to the reader rather than
    // to the league — and left out entirely for an account with no claim, the way Sync
    // is left out for whoever cannot trigger one. A tab reading "My team" that led to
    // the claim screen would be naming something that does not exist yet; the home page
    // is where that invitation already lives.
    ...(myTeamId === null ? [] : [{ href: `/teams/${myTeamId}`, label: "My team" }]),
    { href: "/standings", label: "Standings" },
    { href: "/progress", label: "Progress" },
    { href: "/players", label: "Players" },
    { href: "/market", label: "Market" },
    // Beside the log it is read from. The register is the league's own rule; the poll
    // after it is a game, and the order says which is which.
    { href: "/fair-play", label: "Fair play" },
    { href: "/necroporra", label: "Necroporra" },
    // Last of the shared destinations: the law is the page consulted least and cited
    // most. Everything to its left changes every week; this changes when the league
    // rules something new.
    { href: "/constitution", label: "Constitution" },
    ...(canTriggerSync ? [{ href: "/admin/sync", label: "Sync" }] : []),
  ];

  return (
    <div
      className="flex flex-wrap items-center border-b px-4 text-[12.5px]"
      style={{ borderColor: "var(--board-line)" }}
    >
      {destinations.map(({ href, label }) => {
        // `/players/38128693` is still the players section; `/` is nobody's section.
        // And because "My team" carries the reader's own id rather than `/teams`, a
        // rival's squad leaves it dark, which is the only honest thing for a tab that
        // says "my".
        const current = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? "page" : undefined}
            className="px-2 py-2"
            style={{
              color: current ? "var(--board-ink)" : "var(--board-ink-dim)",
              // The tab marker is ink, never the amber: amber is reserved for marking
              // the reader's own team, and a colour that means two things means neither.
              boxShadow: current ? "inset 0 -2px 0 var(--board-ink)" : undefined,
            }}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}
