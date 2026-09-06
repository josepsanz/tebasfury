import { roles, type RoleName } from "./permissions";

export type Permissions = Parameters<(typeof roles)["admin"]["authorize"]>[0];
type SessionLike = { user: { id: string; role?: string | null } } | null;

export type AccessDecision = { kind: "allow" } | { kind: "redirect"; to: string };

/**
 * Decides whether a session may reach a resource. A pure function with no I/O,
 * which is what makes the access rule testable without standing up Next.
 */
export function decideAccess(session: SessionLike, permissions: Permissions): AccessDecision {
  if (!session) return { kind: "redirect", to: "/login" };

  const roleName = session.user.role as RoleName;
  if (!Object.hasOwn(roles, roleName)) return { kind: "redirect", to: "/" };
  const role = roles[roleName];

  return role.authorize(permissions).success ? { kind: "allow" } : { kind: "redirect", to: "/" };
}
