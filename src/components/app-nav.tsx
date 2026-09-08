import Link from "next/link";
import { decideAccess, getSession } from "@/lib/auth/guards";
import { SignOutButton } from "@/components/sign-out-button";
import { NavLinks } from "@/components/nav-links";

/**
 * Two tiers, because six destinations do not fit one line on a phone.
 *
 * The top line is who you are: the wordmark, your name, the way out. The second is
 * where you can go. Splitting them costs about 32 vertical pixels on every page and
 * buys full-length labels at 375px with nothing abbreviated, nothing scrolled sideways
 * and nothing hidden behind a menu — which for a portal whose fair-play log only works
 * if people actually visit it is the trade worth making.
 */
export async function AppNav() {
  const session = await getSession();
  const canTriggerSync = decideAccess(session, { sync: ["trigger"] }).kind === "allow";

  return (
    <nav>
      <div
        className="flex items-center gap-4 border-b px-6 py-3"
        style={{ borderColor: "var(--board-line)" }}
      >
        <Link href="/" className="font-semibold">
          TebasFury
        </Link>
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
