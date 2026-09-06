import { describe, expect, it } from "vitest";
import { roles } from "./permissions";

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
    it.each([
      ["crear enquestes", { poll: ["create"] }],
      ["resoldre enquestes", { poll: ["resolve"] }],
      ["anotar el fair play", { fairplay: ["annotate"] }],
      ["forçar la sincronització", { sync: ["trigger"] }],
      ["corregir dades de la lliga", { leagueData: ["correct"] }],
    ] as const)("pot %s", (_nom, permis) => {
      expect(roles.colaborator.authorize(permis).success).toBe(true);
    });

    it("no pot gestionar usuaris", () => {
      expect(roles.colaborator.authorize({ user: ["set-role"] }).success).toBe(false);
    });
  });

  describe("admin", () => {
    it("pot gestionar usuaris", () => {
      expect(roles.admin.authorize({ user: ["set-role"] }).success).toBe(true);
    });

    it("pot fer tot el que fa un colaborator", () => {
      expect(roles.admin.authorize({ poll: ["create"], sync: ["trigger"] }).success).toBe(
        true,
      );
    });
  });
});
