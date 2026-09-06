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
  });

  describe("admin", () => {
    it("can manage users", () => {
      expect(roles.admin.authorize({ user: ["set-role"] }).success).toBe(true);
    });

    it.each(grantCases)("can do everything a collaborator can: %s:%s", (resource, action) => {
      expect(roles.admin.authorize(permissionFor(resource, action)).success).toBe(true);
    });
  });
});
