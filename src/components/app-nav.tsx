import Link from "next/link";
import { decideAccess, getSession } from "@/lib/auth/guards";

export async function AppNav() {
  const session = await getSession();
  const potSincronitzar =
    decideAccess(session, { sync: ["trigger"] }).kind === "allow";

  return (
    <nav className="flex items-center gap-4 border-b px-6 py-3">
      <Link href="/" className="font-semibold">
        TebasFury
      </Link>
      {potSincronitzar && <Link href="/admin/sincronitzacio">Sincronització</Link>}
      <span className="ml-auto text-sm">
        {session ? session.user.name : <Link href="/login">Entra</Link>}
      </span>
    </nav>
  );
}
