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

/** Where a pariah is sent from any page the league has closed to them. */
export const PARIAH_PAGE = "/pariah";

export function isPariah(session: SessionLike): boolean {
  return session?.user.role === "pariah";
}

/**
 * A pariah may look at one team: their own. Everybody else may look at any. A pariah
 * with no claimed team has no own team, so every team is closed to them.
 */
export function decidePariahTeamAccess(
  session: SessionLike,
  teamId: string,
  myTeamId: string | null,
): AccessDecision {
  if (!isPariah(session) || teamId === myTeamId) return { kind: "allow" };
  return { kind: "redirect", to: PARIAH_PAGE };
}
