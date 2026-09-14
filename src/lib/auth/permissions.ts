import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access";

/** The portal's resources and the actions available on each of them. */
export const statement = {
  ...defaultStatements,
  /**
   * `voteFor` is entering a ballot in another manager's name — see the admin role, which
   * is the only one that gets it.
   */
  poll: ["create", "publish", "close", "resolve", "voteFor"],
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
  /**
   * The one poll action a collaborator does not get, and the first time this role has had
   * to name anything of its own beyond user management.
   *
   * Closing a round and speaking in another manager's name are different sizes of act —
   * the same line `access: ["manage"]` draws just above. Spelled out rather than
   * inherited, so that widening `collaboratorGrants` later cannot hand it over by
   * accident; a test pins that a collaborator is refused.
   */
  poll: [...collaboratorGrants.poll, "voteFor"],
  access: ["manage"],
  ...adminAc.statements,
});

export const roles = { user, collaborator, admin };

export type RoleName = keyof typeof roles;
