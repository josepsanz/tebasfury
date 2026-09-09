"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Where you can go, and where you are.
 *
 * A client component for one reason: `usePathname`. With six destinations the bar needs
 * to say which one you are on, and a server component cannot know. `AppNav` stays on
 * the server for the session, so this is the smallest piece that has to ship to the
 * browser.
 *
 * `flex-wrap` is load-bearing, not defensive. These labels come to roughly the width
 * available at 375px, so the row fits with little to spare — and a seventh destination,
 * or a reader whose system text is a size larger, would otherwise lose a destination
 * off the edge with nothing to show that it happened.
 */
export function NavLinks({ canTriggerSync }: { canTriggerSync: boolean }) {
  const pathname = usePathname();

  const destinations = [
    { href: "/standings", label: "Standings" },
    { href: "/progress", label: "Progress" },
    { href: "/players", label: "Players" },
    { href: "/market", label: "Market" },
    ...(canTriggerSync ? [{ href: "/admin/sync", label: "Sync" }] : []),
  ];

  return (
    <div
      className="flex flex-wrap items-center border-b px-4 text-[12.5px]"
      style={{ borderColor: "var(--board-line)" }}
    >
      {destinations.map(({ href, label }) => {
        // `/players/38128693` is still the players section; `/` is nobody's section.
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
