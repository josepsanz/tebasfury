import Link from "next/link";
import { db } from "@/lib/db";
import { loadLeagueStatus } from "@/lib/db/queries";
import { decideAccess, getSession } from "@/lib/auth/guards";
import { SignOutButton } from "@/components/sign-out-button";
import { NavLinks } from "@/components/nav-links";

/**
 * The hour a sync landed, in the league's own timezone.
 *
 * Server-rendered and absolute, not "2 minutes ago": a relative time computed on the
 * server is wrong the moment the page is cached or left open, and computing it in the
 * browser would ship a client component to every page for one line of text. An hour is
 * what a reader actually needs — it answers "is this from before tonight's matches?".
 */
function syncedAt(at: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}

/**
 * The status strip and the tabs.
 *
 * The strip is the market clock: which gameweek the portal is showing, whether it is
 * being played right now, and how fresh the numbers are. Every page carries it because
 * every page shows figures whose meaning depends on it — a table read during a live
 * round and the same table on Tuesday are different claims.
 */
export async function AppNav() {
  const session = await getSession();
  const canTriggerSync = decideAccess(session, { sync: ["trigger"] }).kind === "allow";
  const status = session ? await loadLeagueStatus(db) : null;

  return (
    <nav>
      <div
        className="flex items-center gap-4 border-b px-6 py-2"
        style={{ borderColor: "var(--board-line)", background: "var(--board-panel)" }}
      >
        <Link href="/" className="font-semibold">
          TebasFury
        </Link>

        {status ? (
          <span className="flex items-center gap-3 text-[11.5px]">
            {status.gameweek === null ? (
              <span style={{ color: "var(--board-ink-dim)" }}>no gameweek synced</span>
            ) : (
              <span style={{ color: status.isLive ? "var(--board-gain)" : "var(--board-ink-dim)" }}>
                {status.isLive ? `GW${status.gameweek} live` : `GW${status.gameweek} final`}
              </span>
            )}
            {status.lastSync ? (
              <span style={{ color: "var(--board-ink-dim)" }}>synced {syncedAt(status.lastSync)}</span>
            ) : null}
          </span>
        ) : null}

        <span className="ml-auto flex items-center gap-3 text-sm">
          {session ? (
            <>
              {session.user.name}
              <SignOutButton />
            </>
          ) : (
            <Link href="/login">Sign in</Link>
          )}
        </span>
      </div>
      {session && <NavLinks canTriggerSync={canTriggerSync} />}
    </nav>
  );
}
