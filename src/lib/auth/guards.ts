import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";
import { roles, type RoleName } from "./permissions";

type Permissions = Parameters<(typeof roles)["admin"]["authorize"]>[0];
type SessionLike = { user: { id: string; role?: string | null } } | null;

export type AccessDecision = { kind: "allow" } | { kind: "redirect"; to: string };

/**
 * Decideix si una sessió pot accedir a un recurs. Funció pura, sense I/O:
 * és el que fa que la regla d'accés sigui testejable sense aixecar Next.
 */
export function decideAccess(session: SessionLike, permissions: Permissions): AccessDecision {
  if (!session) return { kind: "redirect", to: "/login" };

  const role = roles[session.user.role as RoleName];
  if (!role) return { kind: "redirect", to: "/" };

  return role.authorize(permissions).success ? { kind: "allow" } : { kind: "redirect", to: "/" };
}

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function requirePermission(permissions: Permissions) {
  const session = await getSession();
  const decision = decideAccess(session, permissions);
  if (decision.kind === "redirect") redirect(decision.to);
  return session!;
}
