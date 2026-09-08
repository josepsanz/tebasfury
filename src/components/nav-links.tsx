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
 * `flex-wrap` is load-bearing, not defensive. At 375px these labels come to roughly 340
 * of the 347 pixels available, so the row fits with two per cent to spare — and a
 * seventh destination, or a reader whose system text is a size larger, would otherwise
 * lose a destination off the edge with nothing to show that it happened.
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
      className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-6 py-2 text-[13.5px]"
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
            style={{ color: current ? "var(--board-ink)" : "var(--board-ink-dim)" }}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}
