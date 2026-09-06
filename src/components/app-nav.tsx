import Link from "next/link";
import { decideAccess, getSession } from "@/lib/auth/guards";
import { SignOutButton } from "@/components/sign-out-button";

export async function AppNav() {
  const session = await getSession();
  const canTriggerSync =
    decideAccess(session, { sync: ["trigger"] }).kind === "allow";

  return (
    <nav className="flex items-center gap-4 border-b px-6 py-3">
      <Link href="/" className="font-semibold">
        TebasFury
      </Link>
      {canTriggerSync && <Link href="/admin/sync">Sync</Link>}
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
    </nav>
  );
}
