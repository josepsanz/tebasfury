import { describe, expect, it } from "vitest";
import { collaboratorGrants, roles } from "./permissions";
import type { Permissions } from "./access-decision";

/** Every (resource, action) pair that `collaboratorGrants` hands out. */
const grantCases = Object.entries(collaboratorGrants).flatMap(([resource, actions]) =>
  actions.map((action) => [resource, action] as const),
);

function permissionFor(resource: string, action: string): Permissions {
  return { [resource]: [action] } as Permissions;
}

describe("role policies", () => {
  describe("user", () => {
    it("can read the fair play register", () => {
      expect(roles.user.authorize({ fairplay: ["read"] }).success).toBe(true);
    });

    it("cannot create polls", () => {
      expect(roles.user.authorize({ poll: ["create"] }).success).toBe(false);
    });

    it("cannot trigger a sync", () => {
      expect(roles.user.authorize({ sync: ["trigger"] }).success).toBe(false);
    });

    it("cannot correct league data", () => {
      expect(roles.user.authorize({ leagueData: ["correct"] }).success).toBe(false);
    });

    it("cannot enter another manager's ballot", () => {
      expect(roles.user.authorize({ poll: ["voteFor"] }).success).toBe(false);
    });
  });

  describe("collaborator", () => {
    it.each(grantCases)("can %s:%s", (resource, action) => {
      expect(roles.collaborator.authorize(permissionFor(resource, action)).success).toBe(
        true,
      );
    });

    it("cannot manage users", () => {
      expect(roles.collaborator.authorize({ user: ["set-role"] }).success).toBe(false);
    });

    it("cannot enter another manager's ballot, though it may close the round", () => {
      // The first poll action that is NOT in `collaboratorGrants`, so the admin role has
      // to name it and stops being a pure superset. This test is what stops the exception
      // being lost the next time somebody tidies the role composition.
      expect(roles.collaborator.authorize({ poll: ["close"] }).success).toBe(true);
      expect(roles.collaborator.authorize({ poll: ["voteFor"] }).success).toBe(false);
    });
  });

  describe("admin", () => {
    it("can manage users", () => {
      expect(roles.admin.authorize({ user: ["set-role"] }).success).toBe(true);
    });

    it("can enter another manager's ballot", () => {
      expect(roles.admin.authorize({ poll: ["voteFor"] }).success).toBe(true);
    });

    it.each(grantCases)("can do everything a collaborator can: %s:%s", (resource, action) => {
      expect(roles.admin.authorize(permissionFor(resource, action)).success).toBe(true);
    });
  });
});
