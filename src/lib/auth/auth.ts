import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin as adminPlugin } from "better-auth/plugins";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { getEnv } from "@/lib/env";
import { loadAllowedEmails } from "@/lib/access";
import { NOT_IN_LEAGUE, isAdmin, isAllowed } from "./allowlist";
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
    /**
     * The gate. Runs for `create-user`, `link-account` AND `sign-in`, which is what
     * makes it the right seam: a check that only guarded account creation would let
     * every row that already exists keep signing in for ever. On `sign-in` it receives
     * the FRESH provider email rather than the stored row, so the decision is made
     * against what Google asserts today.
     *
     * It runs before the session cookie is set — `callback.mjs` reaches
     * `setSessionCookie` only on the success path — so a refused visitor gets a
     * redirect and nothing else. That is the ruling "an outsider sees nothing", and it
     * is the library's control flow that enforces it, not our diligence.
     *
     * Returning `{ error }` becomes a 403 that the OAuth callback turns into
     * `?error=<code>` on the error URL below. Better Auth also fails closed if this
     * throws, so a bug here cannot open the door.
     */
    validateUserInfo: async ({ user }) => {
      const { ADMIN_EMAIL } = getEnv();

      // The owner first, and WITHOUT touching the database. The list lives in a table
      // now, and the one account that could repair a broken or unreachable table must
      // not depend on reading it. This is the door that needs nothing but an env var.
      if (isAdmin(user.email, ADMIN_EMAIL)) return;

      const allowed = await loadAllowedEmails(db);
      if (isAllowed(user.email, allowed, ADMIN_EMAIL)) return;

      return {
        error: NOT_IN_LEAGUE,
        errorDescription: "This account is not on the league's list.",
      };
    },
  },
  onAPIError: {
    // Every OAuth failure already routes through one helper that appends `?error=`, so
    // `/login` is where they all land. It has to tell the refusal above apart from an
    // ordinary failure: saying "you are not in this league" after a network fault would
    // send a friend to the owner for the wrong reason.
    errorURL: "/login",
  },
  /**
   * `baseURL` is trusted already; these are the extras.
   *
   * Deliberately NOT `https://*.vercel.app`, which would trust every application
   * anybody has ever deployed to Vercel. The wildcard matches against the request's
   * host, so pinning the project's own preview names costs nothing.
   *
   * The LAN-IP dev server stays untrusted on purpose: the recorded cure is to use
   * `localhost`, and blessing a machine's address here would only half-fix a URL that
   * also breaks hydration.
   */
  trustedOrigins: ["http://localhost:3000", "https://tebasfury-*.vercel.app"],
  plugins: [
    adminPlugin({ ac, roles, adminRoles: ["admin"], defaultRole: "user" }),
    // nextCookies must always be the last plugin in the list.
    nextCookies(),
  ],
});
