import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin as adminPlugin } from "better-auth/plugins";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { getEnv } from "@/lib/env";
import { ac, roles } from "./permissions";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  socialProviders: {
    google: {
      clientId: getEnv().GOOGLE_CLIENT_ID,
      clientSecret: getEnv().GOOGLE_CLIENT_SECRET,
    },
  },
  user: {
    additionalFields: {
      fantasyTeamId: { type: "string", required: false, input: false },
    },
  },
  plugins: [
    adminPlugin({ ac, roles, adminRoles: ["admin"], defaultRole: "user" }),
    // nextCookies ha de ser sempre l'últim plugin de la llista.
    nextCookies(),
  ],
});
