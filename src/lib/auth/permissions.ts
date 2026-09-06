import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access";

/** Recursos del portal i accions possibles sobre cadascun. */
export const statement = {
  ...defaultStatements,
  poll: ["create", "publish", "close", "resolve"],
  fairplay: ["read", "annotate", "delete"],
  sync: ["trigger"],
  leagueData: ["correct"],
} as const;

export const ac = createAccessControl(statement);

/** Manager de la lliga: consulta i vota, però no administra res. */
const user = ac.newRole({
  fairplay: ["read"],
});

/**
 * Concessions del colaborator: tot el que fa l'admin excepte gestionar
 * usuaris i rols. Es defineixen un sol cop aquí perquè `admin` les hereti
 * per composició en lloc de repetir-les — si `colaborator` guanya un recurs
 * nou, `admin` el rep automàticament.
 */
export const colaboratorGrants = {
  poll: ["create", "publish", "close", "resolve"],
  fairplay: ["read", "annotate", "delete"],
  sync: ["trigger"],
  leagueData: ["correct"],
} as const;

/** Tot el que fa l'admin excepte gestionar usuaris i rols. */
const colaborator = ac.newRole({ ...colaboratorGrants });

const admin = ac.newRole({
  ...colaboratorGrants,
  ...adminAc.statements,
});

export const roles = { user, colaborator, admin };

export type RoleName = keyof typeof roles;
