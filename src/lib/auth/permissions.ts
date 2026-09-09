import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access";

/** The portal's resources and the actions available on each of them. */
export const statement = {
  ...defaultStatements,
  poll: ["create", "publish", "close", "resolve"],
  fairplay: ["read", "annotate", "delete"],
  sync: ["trigger"],
  leagueData: ["correct"],
  /**
   * Who may sign in at all. Deliberately NOT in `collaboratorGrants`: triggering a sync
   * and deciding who reaches the league are different sizes of act, and a collaborator
   * who can do the first should not silently gain the second.
   */
  access: ["manage"],
} as const;

export const ac = createAccessControl(statement);

/** A league manager: reads and votes, but administers nothing. */
const user = ac.newRole({
  fairplay: ["read"],
});

/**
 * What a collaborator may do: everything an admin may do except manage users
 * and roles. Defined once here so that `admin` inherits it by composition
 * rather than repeating it — if `collaborator` gains a new resource, `admin`
 * picks it up automatically.
 */
export const collaboratorGrants = {
  poll: ["create", "publish", "close", "resolve"],
  fairplay: ["read", "annotate", "delete"],
  sync: ["trigger"],
  leagueData: ["correct"],
  /**
   * Who may sign in at all. Deliberately NOT in `collaboratorGrants`: triggering a sync
   * and deciding who reaches the league are different sizes of act, and a collaborator
   * who can do the first should not silently gain the second.
   */
  access: ["manage"],
} as const;

const collaborator = ac.newRole({ ...collaboratorGrants });

const admin = ac.newRole({
  ...collaboratorGrants,
  access: ["manage"],
  ...adminAc.statements,
});

export const roles = { user, collaborator, admin };

export type RoleName = keyof typeof roles;
