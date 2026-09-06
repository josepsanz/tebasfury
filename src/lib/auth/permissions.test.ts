import { describe, expect, it } from "vitest";
import { colaboratorGrants, roles } from "./permissions";
import type { Permissions } from "./access-decision";

/** Totes les parelles (recurs, acció) que `colaboratorGrants` concedeix. */
const grantCases = Object.entries(colaboratorGrants).flatMap(([resource, actions]) =>
  actions.map((action) => [resource, action] as const),
);

function permissionFor(resource: string, action: string): Permissions {
  return { [resource]: [action] } as Permissions;
}

describe("polítiques de rol", () => {
  describe("user", () => {
    it("pot llegir el registre de fair play", () => {
      expect(roles.user.authorize({ fairplay: ["read"] }).success).toBe(true);
    });

    it("no pot crear enquestes", () => {
      expect(roles.user.authorize({ poll: ["create"] }).success).toBe(false);
    });

    it("no pot forçar la sincronització", () => {
      expect(roles.user.authorize({ sync: ["trigger"] }).success).toBe(false);
    });

    it("no pot corregir dades de la lliga", () => {
      expect(roles.user.authorize({ leagueData: ["correct"] }).success).toBe(false);
    });
  });

  describe("colaborator", () => {
    it.each(grantCases)("pot %s:%s", (resource, action) => {
      expect(roles.colaborator.authorize(permissionFor(resource, action)).success).toBe(
        true,
      );
    });

    it("no pot gestionar usuaris", () => {
      expect(roles.colaborator.authorize({ user: ["set-role"] }).success).toBe(false);
    });
  });

  describe("admin", () => {
    it("pot gestionar usuaris", () => {
      expect(roles.admin.authorize({ user: ["set-role"] }).success).toBe(true);
    });

    it.each(grantCases)("pot fer tot el que fa un colaborator: %s:%s", (resource, action) => {
      expect(roles.admin.authorize(permissionFor(resource, action)).success).toBe(true);
    });
  });
});
